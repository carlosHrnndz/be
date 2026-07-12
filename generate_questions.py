import os
import sys
import json
import time
import hashlib
import requests

# Base directories
WORKSPACE_DIR = "/Users/carlos/Documents/Antigravity/BE"
MARKDOWN_DIR = os.path.join(WORKSPACE_DIR, "material", "markdown")
OUTPUT_FILE = os.path.join(WORKSPACE_DIR, "src", "data", "questions.json")
TEMP_STATE_FILE = os.path.join(WORKSPACE_DIR, "src", "data", "questions_progress.json")

# Ensure output directory exists
os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

def load_env(path="/Users/carlos/.env"):
    """Loads environment variables from a .env file."""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()

# Load env variables
load_env()
load_env(os.path.join(WORKSPACE_DIR, ".env"))

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("ERROR: GEMINI_API_KEY is not defined in /Users/carlos/.env or project root .env", file=sys.stderr)
    print("Please run the secure command to set up the API key before running this script.", file=sys.stderr)
    sys.exit(1)

def get_chunk_hash(file_path, chunk_index, chunk_content):
    """Generates a unique hash for a chunk based on file path, index, and content."""
    hasher = hashlib.md5()
    hasher.update(file_path.encode("utf-8"))
    hasher.update(str(chunk_index).encode("utf-8"))
    hasher.update(chunk_content.encode("utf-8"))
    return hasher.hexdigest()

def chunk_file(file_path, chunk_size=12000, overlap=1500):
    """Chunks a file into overlapping text pieces."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    chunks = []
    start = 0
    while start < len(content):
        end = start + chunk_size
        chunk_content = content[start:end]
        chunks.append(chunk_content)
        start += (chunk_size - overlap)
    
    return chunks

def call_gemini_api(prompt, text_chunk, file_name):
    """Calls the Gemini 2.5 Flash API with Structured JSON Output."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={API_KEY}"
    
    system_instruction = (
        "Eres un experto creador de exámenes tipo test para oposiciones públicas del Banco de España. "
        "Tu objetivo es crear preguntas de examen de alta dificultad, rigor y precisión basándote únicamente en el texto proporcionado. "
        "Cada pregunta debe cumplir de forma estricta las siguientes condiciones:\n"
        "1. Debe estar redactada en un español formal y preciso.\n"
        "2. Debe tener una pregunta clara y directa.\n"
        "3. Debe ofrecer exactamente 4 opciones de respuesta (a, b, c, d), donde SOLO UNA sea correcta y las otras 3 sean incorrectas pero plausibles (no pongas opciones absurdas o del tipo 'ninguna de las anteriores').\n"
        "4. En el campo 'explanation', debes explicar de forma clara por qué la opción correcta es la correcta basándote en la teoría. "
        "A continuación, debes incluir exactamente DOS líneas en blanco (es decir, tres caracteres de salto de línea consecutivos \\n\\n\\n) "
        "y después escribir un ejemplo práctico o caso contextualizado que ilustre el concepto o norma en cuestión.\n"
        "5. El formato de la explicación DEBE seguir esta estructura exacta: '[Explicación teórica]\\n\\n\\nEjemplo: [Ejemplo práctico/contextual]'\n"
        "6. Extrae todas las preguntas posibles de cada texto, centrándote en datos concretos: años, cantidades, porcentajes, nombres de cargos, plazos y definiciones exactas."
    )
    
    user_prompt = (
        f"Genera todas las preguntas tipo test posibles a partir del siguiente fragmento del documento '{file_name}'. "
        "Devuelve un array JSON de objetos con el esquema requerido.\n\n"
        f"Texto del fragmento:\n\"\"\"\n{text_chunk}\n\"\"\""
    )
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": user_prompt}
                ]
            }
        ],
        "systemInstruction": {
            "parts": [
                {"text": system_instruction}
            ]
        },
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "question": {"type": "STRING"},
                        "options": {
                            "type": "OBJECT",
                            "properties": {
                                "a": {"type": "STRING"},
                                "b": {"type": "STRING"},
                                "c": {"type": "STRING"},
                                "d": {"type": "STRING"}
                            },
                            "required": ["a", "b", "c", "d"]
                        },
                        "correctAnswer": {"type": "STRING", "enum": ["a", "b", "c", "d"]},
                        "explanation": {"type": "STRING"}
                    },
                    "required": ["question", "options", "correctAnswer", "explanation"]
                }
            }
        }
    }
    
    headers = {"Content-Type": "application/json"}
    
    # Retry logic
    for attempt in range(3):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                print(f"Rate limited (429). Waiting 30 seconds before retry (attempt {attempt+1}/3)...")
                time.sleep(30)
            else:
                print(f"Error {response.status_code}: {response.text}")
                time.sleep(5)
        except Exception as e:
            print(f"Exception during request: {e}")
            time.sleep(5)
            
    return None

def main():
    # Load progress if exists
    progress = {}
    if os.path.exists(TEMP_STATE_FILE):
        try:
            with open(TEMP_STATE_FILE, "r", encoding="utf-8") as f:
                progress = json.load(f)
            print(f"Loaded progress: {len(progress.get('processed_chunks', {}))} chunks already processed, {len(progress.get('questions', []))} questions saved.")
        except Exception as e:
            print(f"Warning: Failed to load progress file: {e}")
            progress = {"processed_chunks": {}, "questions": []}
    else:
        progress = {"processed_chunks": {}, "questions": []}

    # Find all markdown files
    md_files = [f for f in os.listdir(MARKDOWN_DIR) if f.endswith(".md")]
    md_files.sort()
    
    print(f"Found {len(md_files)} markdown files in {MARKDOWN_DIR}")
    
    total_chunks = 0
    all_chunks_to_process = []
    
    for file_name in md_files:
        file_path = os.path.join(MARKDOWN_DIR, file_name)
        chunks = chunk_file(file_path)
        total_chunks += len(chunks)
        for idx, chunk_content in enumerate(chunks):
            chunk_hash = get_chunk_hash(file_name, idx, chunk_content)
            all_chunks_to_process.append({
                "file_name": file_name,
                "file_path": file_path,
                "chunk_index": idx,
                "content": chunk_content,
                "hash": chunk_hash
            })
            
    print(f"Total chunks across all files: {total_chunks}")
    
    processed_count = 0
    skipped_count = 0
    
    for item in all_chunks_to_process:
        chunk_hash = item["hash"]
        if chunk_hash in progress["processed_chunks"]:
            skipped_count += 1
            continue
            
        print(f"Processing '{item['file_name']}' - Chunk {item['chunk_index']+1}/{total_chunks}...")
        
        # Call API
        result = call_gemini_api("", item["content"], item["file_name"])
        
        if result:
            try:
                # Extract the text content from the Gemini response structure
                candidates = result.get("candidates", [])
                if candidates:
                    content_parts = candidates[0].get("content", {}).get("parts", [])
                    if content_parts:
                        json_text = content_parts[0].get("text", "")
                        new_questions = json.loads(json_text)
                        
                        # Add metadata
                        for q in new_questions:
                            q["id"] = f"q_{hashlib.md5(q['question'].encode('utf-8')).hexdigest()[:10]}"
                            q["source"] = item["file_name"]
                            
                        progress["questions"].extend(new_questions)
                        progress["processed_chunks"][chunk_hash] = True
                        processed_count += 1
                        
                        # Write progress incrementally
                        with open(TEMP_STATE_FILE, "w", encoding="utf-8") as f:
                            json.dump(progress, f, indent=2, ensure_ascii=False)
                            
                        print(f"  Successfully generated {len(new_questions)} questions (Total so far: {len(progress['questions'])}).")
                    else:
                        print("  Error: Empty parts in Gemini response.")
                else:
                    print("  Error: No candidates in Gemini response.")
            except Exception as e:
                print(f"  Error parsing Gemini JSON output: {e}")
                print(f"  Result structure: {json.dumps(result)[:200]}...")
        else:
            print(f"  Error: Failed to get response from Gemini for chunk {item['chunk_index']+1}.")
            
        # Be nice to the API rate limit (Gemini 2.5 Flash free tier limits)
        time.sleep(4.5)
        
    print(f"Generation finished! Processed: {processed_count}, Skipped: {skipped_count}.")
    
    # Save final output
    if len(progress["questions"]) > 0:
        # Deduplicate by question text
        unique_questions = []
        seen_questions = set()
        for q in progress["questions"]:
            q_text_clean = q["question"].strip().lower()
            if q_text_clean not in seen_questions:
                seen_questions.add(q_text_clean)
                unique_questions.append(q)
                
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(unique_questions, f, indent=2, ensure_ascii=False)
            
        print(f"Saved {len(unique_questions)} unique questions to {OUTPUT_FILE}")
        
        # Clean up progress file
        if os.path.exists(TEMP_STATE_FILE):
            os.remove(TEMP_STATE_FILE)
            print("Removed temporary progress file.")
    else:
        print("No questions were generated.")

if __name__ == "__main__":
    main()
