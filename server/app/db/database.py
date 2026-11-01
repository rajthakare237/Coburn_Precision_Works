import os
from motor.motor_asyncio import AsyncIOMotorClient
from pinecone import Pinecone
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "main_database")

client = AsyncIOMotorClient(MONGO_URI)
mongodb = client[DB_NAME]

tickets_collection = mongodb["tickets"]
work_orders_collection = mongodb["work_orders"]
users_collection = mongodb["users"]

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "coburn-precision-works")

pc = Pinecone(api_key=PINECONE_API_KEY) if PINECONE_API_KEY and PINECONE_API_KEY != "your_pinecone_api_key_here" else None
pinecone_index = pc.Index(PINECONE_INDEX_NAME) if pc else None

async def get_db():
    try:
        yield mongodb
    finally:
        pass