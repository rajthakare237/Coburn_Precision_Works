from fastapi import APIRouter, HTTPException, Response, Request, Depends
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
import uuid

from app.db.database import tickets_collection, work_orders_collection, users_collection
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_current_user,
    require_admin
)

router = APIRouter()

# --- SCHEMAS ---
class LoginRequest(BaseModel):
    email: str
    password: str

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "Operator"

class RoleUpdateRequest(BaseModel):
    role: str

# --- AUTHENTICATION ROUTES ---

@router.post("/auth/login")
async def login(req: LoginRequest, response: Response):
    email = req.email.strip().lower()
    user = await users_collection.find_one({"email": email})
    if not user or not verify_password(req.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.get("status") == "PENDING":
        raise HTTPException(status_code=403, detail="Your account is pending administrator approval.")

    token_payload = {
        "sub": user["email"],
        "role": user.get("role", "Operator"),
        "name": user.get("name", "User"),
        "userId": str(user["_id"])
    }
    access_token = create_access_token(token_payload)
    refresh_token = create_refresh_token(token_payload)

    # Store Refresh Token in HttpOnly Cookie + Session Cookie for visibility
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=7 * 24 * 60 * 60,
        path="/"
    )
    response.set_cookie(
        key="cpw_authenticated",
        value="true",
        httponly=False,
        samesite="lax",
        secure=False,
        max_age=7 * 24 * 60 * 60,
        path="/"
    )

    return {
        "accessToken": access_token,
        "user": {
            "id": str(user["_id"]),
            "name": user.get("name", "User"),
            "email": user["email"],
            "role": user.get("role", "Operator"),
            "status": user.get("status", "ACTIVE")
        }
    }

@router.post("/auth/signup")
async def signup(req: SignupRequest):
    email = req.email.strip().lower()
    exists = await users_collection.find_one({"email": email})
    if exists:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    new_user = {
        "name": req.name.strip(),
        "email": email,
        "password": hash_password(req.password),
        "role": req.role if req.role in ["Admin", "Floor Manager", "Maintenance Tech", "Operator"] else "Operator",
        "status": "PENDING",
        "joined": datetime.now(timezone.utc).isoformat()
    }
    await users_collection.insert_one(new_user)
    return {"message": "Access request submitted! An administrator will review your request."}

@router.post("/auth/refresh")
async def refresh_access_token(request: Request, response: Response):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    payload = decode_refresh_token(refresh_token)
    email = payload.get("sub")
    user = await users_collection.find_one({"email": email})
    if not user or user.get("status") != "ACTIVE":
        raise HTTPException(status_code=401, detail="User no longer active")

    new_payload = {
        "sub": user["email"],
        "role": user.get("role", "Operator"),
        "name": user.get("name", "User"),
        "userId": str(user["_id"])
    }
    new_access_token = create_access_token(new_payload)
    new_refresh_token = create_refresh_token(new_payload)

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=7 * 24 * 60 * 60,
        path="/"
    )

    return {
        "accessToken": new_access_token,
        "user": {
            "id": str(user["_id"]),
            "name": user.get("name", "User"),
            "email": user["email"],
            "role": user.get("role", "Operator"),
            "status": user.get("status", "ACTIVE")
        }
    }

@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("cpw_authenticated", path="/")
    return {"message": "Logged out successfully"}

@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "id": current_user["_id"],
        "name": current_user.get("name"),
        "email": current_user.get("email"),
        "role": current_user.get("role"),
        "status": current_user.get("status")
    }

# --- ADMIN PANEL USER MANAGEMENT ROUTES ---

@router.get("/users")
async def get_users(admin: dict = Depends(require_admin)):
    users = await users_collection.find({}, {"password": 0}).sort("joined", -1).to_list(500)
    for u in users:
        u["_id"] = str(u["_id"])
    return users

@router.post("/users/admin")
async def create_user_by_admin(req: SignupRequest, admin: dict = Depends(require_admin)):
    email = req.email.strip().lower()
    exists = await users_collection.find_one({"email": email})
    if exists:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    new_user = {
        "name": req.name.strip(),
        "email": email,
        "password": hash_password(req.password),
        "role": req.role,
        "status": "ACTIVE",
        "joined": datetime.now(timezone.utc).isoformat()
    }
    res = await users_collection.insert_one(new_user)
    new_user["_id"] = str(res.inserted_id)
    new_user.pop("password", None)
    return new_user

@router.patch("/users/{user_id}/approve")
async def approve_user(user_id: str, admin: dict = Depends(require_admin)):
    await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"status": "ACTIVE", "joined": datetime.now(timezone.utc).isoformat()}}
    )
    return {"status": "approved"}

@router.patch("/users/{user_id}/role")
async def update_user_role(user_id: str, req: RoleUpdateRequest, admin: dict = Depends(require_admin)):
    await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": req.role}}
    )
    return {"status": "role_updated", "role": req.role}

@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = await users_collection.find_one({"_id": ObjectId(user_id)})
    if target and target.get("email") == "admin@gmail.com":
        raise HTTPException(status_code=400, detail="Cannot delete the primary system administrator.")
    await users_collection.delete_one({"_id": ObjectId(user_id)})
    return {"status": "deleted"}

# --- TICKETS CRUD ---

@router.get("/tickets")
async def get_tickets(current_user: dict = Depends(get_current_user)):
    tickets = await tickets_collection.find({}).sort("createdAt", -1).to_list(250)
    for t in tickets:
        t["_id"] = str(t["_id"])
    return tickets

@router.post("/tickets")
async def create_ticket(ticket: dict, current_user: dict = Depends(get_current_user)):
    ticket["ticketId"] = f"TKT-{datetime.now().year}-{str(uuid.uuid4())[:4].upper()}"
    ticket["status"] = "OPEN"
    ticket["reportedBy"] = ticket.get("reportedBy") or f"{current_user.get('name')} ({current_user.get('role')})"
    ticket["createdAt"] = datetime.now(timezone.utc).isoformat()
    ticket["updatedAt"] = ticket["createdAt"]
    await tickets_collection.insert_one(ticket)
    ticket["_id"] = str(ticket["_id"])
    return ticket

@router.delete("/tickets/{ticket_id}")
async def delete_ticket_route(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await tickets_collection.delete_one({"ticketId": ticket_id})
    return {"status": "deleted"}

@router.patch("/tickets/{ticket_id}")
async def update_ticket_status_route(ticket_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    await tickets_collection.update_one(
        {"ticketId": ticket_id},
        {"$set": {"status": payload["status"], "updatedAt": datetime.now(timezone.utc).isoformat()}}
    )
    return {"status": "updated"}

# --- WORK ORDERS CRUD ---

@router.get("/work-orders")
async def get_work_orders(current_user: dict = Depends(get_current_user)):
    orders = await work_orders_collection.find({}).sort("createdAt", -1).to_list(1000)
    for o in orders:
        o["_id"] = str(o["_id"])
    return orders

@router.post("/work-orders")
async def create_work_order(wo: dict, current_user: dict = Depends(get_current_user)):
    wo["workOrderId"] = f"WO-{str(uuid.uuid4())[:5].upper()}"
    wo["status"] = wo.get("status", "APPROVED")
    wo["createdAt"] = datetime.now(timezone.utc).isoformat()
    wo["updatedAt"] = wo["createdAt"]
    if not wo.get("slaDeadline"):
        wo["slaDeadline"] = datetime.now(timezone.utc).isoformat()
    await work_orders_collection.insert_one(wo)
    wo["_id"] = str(wo["_id"])
    return wo

@router.delete("/work-orders/{wo_id}")
async def delete_work_order_route(wo_id: str, current_user: dict = Depends(get_current_user)):
    await work_orders_collection.delete_one({"workOrderId": wo_id})
    return {"status": "deleted"}

@router.patch("/work-orders/{wo_id}")
async def update_wo_status_route(wo_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    await work_orders_collection.update_one(
        {"workOrderId": wo_id},
        {"$set": {"status": payload["status"], "updatedAt": datetime.now(timezone.utc).isoformat()}}
    )
    return {"status": "updated"}