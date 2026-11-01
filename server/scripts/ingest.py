import os
import re
import time
import json
import PyPDF2
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone, ServerlessSpec

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "coburn-precision-works")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

CHECKPOINT_FILE = os.path.join(os.path.dirname(__file__), 'ingest_progress.json')

if not PINECONE_API_KEY or not GOOGLE_API_KEY:
    print("❌ ERROR: Missing API keys in .env")
    exit(1)

def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_checkpoint(data):
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump(data, f)

# Initialize Clients
pc = Pinecone(api_key=PINECONE_API_KEY)

existing_indexes = [index_info["name"] for index_info in pc.list_indexes()]
if PINECONE_INDEX_NAME not in existing_indexes:
    print(f"⚙️ Creating pure vector Pinecone index: '{PINECONE_INDEX_NAME}'...")
    pc.create_index(
        name=PINECONE_INDEX_NAME,
        dimension=768,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1")
    )
    while not pc.describe_index(PINECONE_INDEX_NAME).status['ready']:
        time.sleep(1)
    print("✅ Index created successfully!")

index = pc.Index(PINECONE_INDEX_NAME)
embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001", google_api_key=GOOGLE_API_KEY)

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=150,
    length_function=len,
    separators=["\n\n", "\n", r"(?<=\. )", " "]
)

def extract_metadata(text: str, filename: str, page_num: int) -> dict:
    fault_code_match = re.search(r"(ERR-[A-Za-z0-9-]+)", text)
    fault_code = fault_code_match.group(1) if fault_code_match else "NONE"

    machine_match = re.search(r"(Siemens-DMG-[A-Za-z0-9]+|Okuma-Multus-[A-Za-z0-9]+|Prismo\s*[A-Za-z0-9]+|Makino-Aero-[A-Za-z0-9]+|Mazak-Integrex-[A-Za-z0-9]+)", text, re.IGNORECASE)
    machine_model = machine_match.group(1) if machine_match else "General"

    return {
        "machineModel": machine_model,
        "faultCode": fault_code,
        "volumeFile": filename,
        "pageNumber": page_num,
        "section": "Manual Extract",
        "text": text
    }

def process_and_upload_pdf(filepath: str):
    filename = os.path.basename(filepath)
    print(f"\n📄 Processing: {filename}")
    
    progress = load_checkpoint()
    start_page = progress.get(filename, 0)
    
    with open(filepath, "rb") as file:
        reader = PyPDF2.PdfReader(file)
        total_pages = len(reader.pages)
        
        if start_page >= total_pages:
            print(f"   ✅ {filename} is already fully processed. Skipping.")
            return

        if start_page > 0:
            print(f"   ⏩ Resuming {filename} from page {start_page + 1} (Skipped {start_page} pages)")

        vectors_to_upsert = []
        i = start_page
        
        try:
            for i in range(start_page, total_pages):
                page_text = reader.pages[i].extract_text()
                if not page_text:
                    continue
                    
                chunks = text_splitter.split_text(page_text)
                
                for chunk_idx, chunk_text in enumerate(chunks):
                    raw_vector = embeddings.embed_query(chunk_text)
                    sliced_vector = raw_vector[:768]
                    metadata = extract_metadata(chunk_text, filename, i + 1)
                    
                    clean_filename = re.sub(r'[^a-zA-Z0-9_-]', '_', filename)
                    record_id = f"{clean_filename}_p{i+1}_c{chunk_idx}"
                    
                    vectors_to_upsert.append({
                        "id": record_id,
                        "values": sliced_vector,
                        "metadata": metadata
                    })

                print(f"   ✓ Embedded Page {i+1}/{total_pages} ({len(chunks)} chunks)")

                if len(vectors_to_upsert) >= 50:
                    index.upsert(vectors=vectors_to_upsert)
                    print(f"   🚀 Upserted batch of {len(vectors_to_upsert)} vectors to Pinecone.")
                    vectors_to_upsert = []
                    
                    progress[filename] = i + 1
                    save_checkpoint(progress)

            if vectors_to_upsert:
                index.upsert(vectors=vectors_to_upsert)
                print(f"   🚀 Upserted final batch of {len(vectors_to_upsert)} vectors to Pinecone.")
                
            progress[filename] = total_pages
            save_checkpoint(progress)

        # GRACEFUL SHUTDOWN: Triggers if you press Ctrl+C
        except KeyboardInterrupt:
            print(f"\n⚠️ Script manually interrupted during page {i+1}!")
            if vectors_to_upsert:
                print("   ⏳ Forcing upload of remaining chunks to Pinecone...")
                index.upsert(vectors=vectors_to_upsert)
                print(f"   🚀 Successfully saved partial batch of {len(vectors_to_upsert)} vectors.")
            
            # FIX: Save 'i' instead of 'i + 1'. Re-running the page safely overwrites without duplicating.
            progress[filename] = i
            save_checkpoint(progress)
            print(f"💾 Checkpoint locked. Will restart from page {i+1} to ensure no missing chunks.")
            exit(0)
            
        # GRACEFUL SHUTDOWN: Triggers on API Quota Exceeded / Network Errors
        except Exception as e:
            print(f"\n❌ Unexpected API Error at page {i+1}: {str(e)}")
            if vectors_to_upsert:
                print("   ⏳ Attempting to save processed chunks before crashing...")
                try:
                    index.upsert(vectors=vectors_to_upsert)
                    print(f"   🚀 Saved {len(vectors_to_upsert)} vectors.")
                except:
                    print("   ❌ Could not reach Pinecone. Vectors discarded.")
                    
            progress[filename] = i
            save_checkpoint(progress)
            print(f"💾 Checkpoint locked. Swap API keys in .env and run again to restart from page {i+1}.")
            exit(1)

    print(f"✅ Finished uploading {filename}")

if __name__ == "__main__":
    docs_dir = os.path.join(os.path.dirname(__file__), 'docs')
    os.makedirs(docs_dir, exist_ok=True)
    
    pdf_files = [f for f in os.listdir(docs_dir) if f.endswith('.pdf')]
    
    if not pdf_files:
        print(f"⚠️ No PDFs found in {docs_dir}. Please place your manuals there and run again.")
    else:
        for pdf in pdf_files:
            process_and_upload_pdf(os.path.join(docs_dir, pdf))