from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.ai_router import router as ai_router
from app.api.routes import router as data_router
from app.db.database import users_collection
from app.core.security import hash_password

app = FastAPI(title="Coburn Precision Works API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://djo6mvw7bibpd.cloudfront.net"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def seed_main_admin():
    admin_email = "admin@gmail.com"
    existing = await users_collection.find_one({"email": admin_email})
    if not existing:
        await users_collection.insert_one({
            "name": "Admin User",
            "email": admin_email,
            "password": hash_password("123456"),
            "role": "Admin",
            "status": "ACTIVE",
            "joined": datetime.now(timezone.utc).isoformat()
        })
    else:
        # Ensure main admin always has Admin role, ACTIVE status, and 123456 password
        await users_collection.update_one(
            {"email": admin_email},
            {"$set": {
                "password": hash_password("123456"),
                "role": "Admin",
                "status": "ACTIVE"
            }}
        )

app.include_router(ai_router)
app.include_router(data_router, prefix="/api")

@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Coburn Precision Works API is running"}