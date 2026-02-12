"""
Wedding Elite V2.0 - Backend API (UPGRADED)
FastAPI application with full CRUD + Auth + Real-time support
"""

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
from datetime import datetime, date, timedelta
import sqlite3
from contextlib import contextmanager
import json
import asyncio
import uuid
import hashlib
import secrets
from collections import defaultdict
from time import time
import logging

# ==================== LOGGING ====================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== FASTAPI APP ====================
app = FastAPI(
    title="Wedding Elite V2.0 API",
    description="Complete wedding planning platform with vendor marketplace",
    version="2.0.0"
)

# ==================== CORS CONFIGURATION ====================
allowed_origins = [
    "https://eladgl.github.io",  # GitHub Pages
    "http://localhost:3000",      # Local development
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "*"  # Allow all for testing
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# ==================== RATE LIMITER ====================
class SimpleRateLimiter:
    """Simple rate limiter to prevent abuse"""
    def __init__(self, max_requests=100, window=60):
        self.max_requests = max_requests
        self.window = window  # seconds
        self.requests = defaultdict(list)
    
    def is_allowed(self, key: str) -> bool:
        now = time()
        # Clean old requests
        self.requests[key] = [req for req in self.requests[key] if now - req < self.window]
        # Check limit
        if len(self.requests[key]) < self.max_requests:
            self.requests[key].append(now)
            return True
        return False

rate_limiter = SimpleRateLimiter(max_requests=100, window=60)

# ==================== PASSWORD HASHING ====================
def hash_password(password: str) -> str:
    """Hash password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return hash_password(password) == hashed

# ==================== SESSION MANAGEMENT ====================
def create_session_token() -> str:
    """Generate secure session token"""
    return secrets.token_urlsafe(32)

# ==================== DATABASE ====================
DATABASE = "wedding_elite_v2.db"

def generate_id() -> str:
    """Generate unique ID using UUID4"""
    return str(uuid.uuid4())

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_database():
    """Initialize database with all tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                user_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Weddings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS weddings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                groom_name TEXT NOT NULL,
                bride_name TEXT NOT NULL,
                wedding_date DATE NOT NULL,
                venue_name TEXT,
                guest_count INTEGER DEFAULT 400,
                total_budget REAL DEFAULT 165000,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        
        # Budget categories table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS budget_categories (
                id TEXT PRIMARY KEY,
                wedding_id TEXT NOT NULL,
                name TEXT NOT NULL,
                icon TEXT,
                planned_amount REAL NOT NULL,
                actual_amount REAL DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id) ON DELETE CASCADE
            )
        """)
        
        # Vendors (marketplace)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vendors (
                id TEXT PRIMARY KEY,
                business_name TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT,
                price_range_min REAL,
                price_range_max REAL,
                location TEXT,
                phone TEXT,
                email TEXT,
                website TEXT,
                instagram TEXT,
                rating REAL DEFAULT 0,
                review_count INTEGER DEFAULT 0,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Vendor bookings (couple's vendors)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vendor_bookings (
                id TEXT PRIMARY KEY,
                wedding_id TEXT NOT NULL,
                vendor_id TEXT,
                category_id TEXT NOT NULL,
                vendor_name TEXT NOT NULL,
                amount REAL NOT NULL,
                deposit_paid REAL DEFAULT 0,
                payment_due_date DATE,
                status TEXT DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id) ON DELETE CASCADE,
                FOREIGN KEY (vendor_id) REFERENCES vendors (id),
                FOREIGN KEY (category_id) REFERENCES budget_categories (id)
            )
        """)
        
        # Tasks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                wedding_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                timeline_period TEXT,
                due_date DATE,
                is_completed INTEGER DEFAULT 0,
                is_urgent INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id) ON DELETE CASCADE
            )
        """)
        
        # Reviews table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                wedding_id TEXT NOT NULL,
                vendor_id TEXT NOT NULL,
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id),
                FOREIGN KEY (vendor_id) REFERENCES vendors (id)
            )
        """)
        
        # Shared access table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS shared_access (
                id TEXT PRIMARY KEY,
                wedding_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                access_type TEXT NOT NULL,
                can_edit INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        
        # Notifications table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                wedding_id TEXT,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                type TEXT,
                is_read INTEGER DEFAULT 0,
                action_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (wedding_id) REFERENCES weddings (id)
            )
        """)
        
        conn.commit()
        logger.info("✅ Database initialized successfully")

def seed_database():
    """Auto-Seed Database with default data"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if we already have data
        cursor.execute("SELECT COUNT(*) as count FROM weddings")
        count = cursor.fetchone()["count"]
        
        if count > 0:
            logger.info("✅ Database already has data, skipping seed...")
            return
        
        logger.info("🌱 Seeding database with default data...")
        
        # Create demo user
        demo_user_id = "demo-user-001"
        cursor.execute("""
            INSERT OR IGNORE INTO users (id, email, password_hash, user_type)
            VALUES (?, ?, ?, ?)
        """, (demo_user_id, "demo@wedding-elite.com", hash_password("demo123"), "couple"))
        
        # Create demo wedding
        demo_wedding_id = "demo-wedding-001"
        cursor.execute("""
            INSERT OR IGNORE INTO weddings 
            (id, user_id, groom_name, bride_name, wedding_date, venue_name, guest_count, total_budget)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (demo_wedding_id, demo_user_id, "יוסי", "חן", "2026-08-15", "אולם אקוודור", 400, 165000))
        
        # Create default budget categories
        default_categories = [
            {"name": "אולם ואירוח", "icon": "🏛️", "planned": 90000, "actual": 85000},
            {"name": "צילום ווידאו", "icon": "📸", "planned": 15000, "actual": 16500},
            {"name": "מוזיקה ובידור", "icon": "🎵", "planned": 12000, "actual": 0},
            {"name": "פרחים ועיצוב", "icon": "💐", "planned": 10500, "actual": 0},
            {"name": "לבוש ויופי", "icon": "💄", "planned": 9000, "actual": 0},
            {"name": "הזמנות ומתנות", "icon": "🎁", "planned": 7500, "actual": 0},
            {"name": "אחר", "icon": "✨", "planned": 6000, "actual": 0}
        ]
        
        for cat in default_categories:
            cat_id = f"cat-{cat['name'][:5]}-{generate_id()[:8]}"
            cursor.execute("""
                INSERT OR IGNORE INTO budget_categories 
                (id, wedding_id, name, icon, planned_amount, actual_amount)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (cat_id, demo_wedding_id, cat["name"], cat["icon"], cat["planned"], cat["actual"]))
        
        # Create default tasks
        default_tasks = [
            {"title": "לשלם מקדמה לצלם", "period": "6-9", "urgent": True},
            {"title": "לבחור DJ או להקה", "period": "6-9", "urgent": False},
            {"title": "להדפיס הזמנות", "period": "3-6", "urgent": True},
            {"title": "לקבוע מאפרת", "period": "3-6", "urgent": False},
            {"title": "ספירת אורחים סופית", "period": "1-3", "urgent": False}
        ]
        
        for task in default_tasks:
            task_id = f"task-{generate_id()[:12]}"
            cursor.execute("""
                INSERT OR IGNORE INTO tasks 
                (id, wedding_id, title, timeline_period, is_urgent, is_completed)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (task_id, demo_wedding_id, task["title"], task["period"], task["urgent"], False))
        
        # Create demo vendors
        demo_vendors = [
            {"name": "אקוודור אירועים", "category": "אולם", "desc": "אולם אירועים מפואר", "min": 80000, "max": 100000},
            {"name": "לייט סטודיו", "category": "צילום", "desc": "צילום מקצועי לחתונות", "min": 12000, "max": 18000},
            {"name": "DJ דניאל", "category": "DJ", "desc": "DJ מקצועי לאירועים", "min": 8000, "max": 15000}
        ]
        
        for vendor in demo_vendors:
            vendor_id = f"vendor-{generate_id()[:10]}"
            cursor.execute("""
                INSERT OR IGNORE INTO vendors 
                (id, business_name, category, description, price_range_min, price_range_max, rating, review_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (vendor_id, vendor["name"], vendor["category"], vendor["desc"], 
                  vendor["min"], vendor["max"], 4.8, 127))
        
        conn.commit()
        logger.info("✅ Database seeded successfully with demo data!")

# Initialize database on startup
init_database()
seed_database()

# ==================== PYDANTIC MODELS ====================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    groom_name: str
    bride_name: str
    wedding_date: date

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class WeddingCreate(BaseModel):
    groom_name: str
    bride_name: str
    wedding_date: date
    total_budget: Optional[float] = 165000
    guest_count: Optional[int] = 400

class WeddingUpdate(BaseModel):
    groom_name: Optional[str] = None
    bride_name: Optional[str] = None
    wedding_date: Optional[date] = None
    venue_name: Optional[str] = None
    total_budget: Optional[float] = None
    guest_count: Optional[int] = None

class WeddingResponse(BaseModel):
    id: str
    groom_name: str
    bride_name: str
    wedding_date: date
    venue_name: Optional[str]
    guest_count: int
    total_budget: float
    days_remaining: int

class BudgetCategoryCreate(BaseModel):
    name: str
    icon: str
    planned_amount: float
    notes: Optional[str] = ""

class BudgetCategoryUpdate(BaseModel):
    name: Optional[str] = None
    planned_amount: Optional[float] = None
    actual_amount: Optional[float] = None
    notes: Optional[str] = None

class BudgetCategoryResponse(BaseModel):
    id: str
    name: str
    icon: str
    planned_amount: float
    actual_amount: float
    percentage_spent: float

class VendorCreate(BaseModel):
    business_name: str
    category: str
    description: Optional[str] = ""
    price_range_min: Optional[float] = None
    price_range_max: Optional[float] = None
    location: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    website: Optional[str] = ""
    instagram: Optional[str] = ""

class VendorBookingCreate(BaseModel):
    vendor_id: Optional[str] = None
    category_id: str
    vendor_name: str
    amount: float
    deposit_paid: Optional[float] = 0
    payment_due_date: Optional[date] = None
    notes: Optional[str] = ""

class VendorBookingUpdate(BaseModel):
    vendor_name: Optional[str] = None
    amount: Optional[float] = None
    deposit_paid: Optional[float] = None
    payment_due_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    timeline_period: Optional[str] = None
    due_date: Optional[date] = None
    is_urgent: Optional[bool] = False

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[date] = None
    is_urgent: Optional[bool] = None

class DashboardResponse(BaseModel):
    days_remaining: int
    control_percentage: int
    tasks_completed: int
    tasks_urgent: int
    tasks_total: int
    budget_planned: float
    budget_actual: float
    budget_remaining: float
    budget_percentage: float

# ==================== HELPER FUNCTIONS ====================

def calculate_days_remaining(wedding_date: date) -> int:
    """Calculate days remaining until wedding"""
    today = datetime.now().date()
    delta = wedding_date - today
    return max(0, delta.days)

def get_default_categories():
    """Default budget categories"""
    return [
        {"name": "אולם ואירוח", "icon": "🏛️", "planned_amount": 90000},
        {"name": "צילום ווידאו", "icon": "📸", "planned_amount": 15000},
        {"name": "מוזיקה ובידור", "icon": "🎵", "planned_amount": 12000},
        {"name": "פרחים ועיצוב", "icon": "💐", "planned_amount": 10500},
        {"name": "לבוש ויופי", "icon": "💄", "planned_amount": 9000},
        {"name": "הזמנות ומתנות", "icon": "🎁", "planned_amount": 7500},
        {"name": "אחר", "icon": "✨", "planned_amount": 6000},
    ]

def get_default_tasks(wedding_date: date):
    """Generate default tasks based on wedding date"""
    days_until = calculate_days_remaining(wedding_date)
    tasks = []
    
    if days_until >= 270:  # 9+ months
        tasks.extend([
            {"title": "בחרו אולם", "timeline_period": "9-12", "is_urgent": False},
            {"title": "הזמינו צלם ווידאו", "timeline_period": "9-12", "is_urgent": False},
            {"title": "תפריט ראשוני עם קייטרינג", "timeline_period": "9-12", "is_urgent": False},
        ])
    
    if 180 <= days_until < 270:  # 6-9 months
        tasks.extend([
            {"title": "בחרו DJ או להקה", "timeline_period": "6-9", "is_urgent": False},
            {"title": "התחילו לחפש שמלת כלה", "timeline_period": "6-9", "is_urgent": False},
            {"title": "עיצוב הזמנות", "timeline_period": "6-9", "is_urgent": False},
        ])
    
    if 90 <= days_until < 180:  # 3-6 months
        tasks.extend([
            {"title": "הדפיסו הזמנות", "timeline_period": "3-6", "is_urgent": True},
            {"title": "קבעו מאפרת ומעצב שיער", "timeline_period": "3-6", "is_urgent": False},
            {"title": "תכננו עיצוב פרחים", "timeline_period": "3-6", "is_urgent": False},
        ])
    
    if 30 <= days_until < 90:  # 1-3 months
        tasks.extend([
            {"title": "ספירת אורחים סופית", "timeline_period": "1-3", "is_urgent": False},
            {"title": "פגישה אחרונה עם ספקים", "timeline_period": "1-3", "is_urgent": False},
        ])
    
    return tasks

# ==================== API ENDPOINTS ====================

@app.get("/")
def root():
    """API root - Quick health check"""
    return {
        "message": "Wedding Elite V2.0 API",
        "version": "2.0.0",
        "status": "running",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
def health_check():
    """Detailed health check with database status"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as count FROM weddings")
            wedding_count = cursor.fetchone()["count"]
            
            cursor.execute("SELECT COUNT(*) as count FROM tasks")
            task_count = cursor.fetchone()["count"]
            
        return {
            "status": "healthy",
            "database": "connected",
            "weddings": wedding_count,
            "tasks": task_count,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

# ==================== AUTH ENDPOINTS ====================

@app.post("/auth/register")
async def register(user: UserRegister):
    """Register new couple"""
    
    # Rate limiting
    if not rate_limiter.is_allowed(f"register_{user.email}"):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if email exists
            cursor.execute("SELECT id FROM users WHERE email = ?", (user.email,))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Email already registered")
            
            # Create user
            user_id = generate_id()
            password_hash = hash_password(user.password)
            
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, user_type)
                VALUES (?, ?, ?, ?)
            """, (user_id, user.email, password_hash, "couple"))
            
            # Create wedding
            wedding_id = generate_id()
            cursor.execute("""
                INSERT INTO weddings 
                (id, user_id, groom_name, bride_name, wedding_date, total_budget, guest_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (wedding_id, user_id, user.groom_name, user.bride_name, 
                  user.wedding_date, 165000, 400))
            
            # Add default categories
            for category in get_default_categories():
                cat_id = generate_id()
                cursor.execute("""
                    INSERT INTO budget_categories (id, wedding_id, name, icon, planned_amount)
                    VALUES (?, ?, ?, ?, ?)
                """, (cat_id, wedding_id, category["name"], category["icon"], category["planned_amount"]))
            
            # Add default tasks
            for task in get_default_tasks(user.wedding_date):
                task_id = generate_id()
                cursor.execute("""
                    INSERT INTO tasks (id, wedding_id, title, timeline_period, is_urgent)
                    VALUES (?, ?, ?, ?, ?)
                """, (task_id, wedding_id, task["title"], task["timeline_period"], task["is_urgent"]))
            
            conn.commit()
            
            # Create session
            session_token = create_session_token()
            
            logger.info(f"New user registered: {user.email}")
            
            return {
                "message": "Registration successful",
                "user_id": user_id,
                "wedding_id": wedding_id,
                "session_token": session_token
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/auth/login")
async def login(credentials: UserLogin):
    """Login existing user"""
    
    # Rate limiting
    if not rate_limiter.is_allowed(f"login_{credentials.email}"):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please wait.")
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Find user
            cursor.execute("SELECT * FROM users WHERE email = ?", (credentials.email,))
            user = cursor.fetchone()
            
            if not user:
                raise HTTPException(status_code=401, detail="Invalid email or password")
            
            # Verify password
            if not verify_password(credentials.password, user["password_hash"]):
                raise HTTPException(status_code=401, detail="Invalid email or password")
            
            # Find wedding
            cursor.execute("SELECT id FROM weddings WHERE user_id = ?", (user["id"],))
            wedding = cursor.fetchone()
            
            if not wedding:
                raise HTTPException(status_code=404, detail="No wedding found for this user")
            
            # Create session
            session_token = create_session_token()
            
            logger.info(f"User logged in: {credentials.email}")
            
            return {
                "message": "Login successful",
                "user_id": user["id"],
                "wedding_id": wedding["id"],
                "session_token": session_token
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== WEDDINGS ====================

@app.post("/weddings", response_model=WeddingResponse)
def create_wedding(wedding: WeddingCreate):
    """Create a new wedding"""
    try:
        wedding_id = generate_id()
        user_id = generate_id()  # Simplified - in production use auth
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Insert wedding
            cursor.execute("""
                INSERT INTO weddings (id, user_id, groom_name, bride_name, wedding_date, total_budget, guest_count)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (wedding_id, user_id, wedding.groom_name, wedding.bride_name, 
                  wedding.wedding_date, wedding.total_budget, wedding.guest_count))
            
            # Add default categories
            for category in get_default_categories():
                cat_id = generate_id()
                cursor.execute("""
                    INSERT INTO budget_categories (id, wedding_id, name, icon, planned_amount)
                    VALUES (?, ?, ?, ?, ?)
                """, (cat_id, wedding_id, category["name"], category["icon"], category["planned_amount"]))
            
            # Add default tasks
            for task in get_default_tasks(wedding.wedding_date):
                task_id = generate_id()
                cursor.execute("""
                    INSERT INTO tasks (id, wedding_id, title, timeline_period, is_urgent)
                    VALUES (?, ?, ?, ?, ?)
                """, (task_id, wedding_id, task["title"], task["timeline_period"], task["is_urgent"]))
            
            conn.commit()
        
        logger.info(f"Wedding created: {wedding_id}")
        
        return WeddingResponse(
            id=wedding_id,
            groom_name=wedding.groom_name,
            bride_name=wedding.bride_name,
            wedding_date=wedding.wedding_date,
            venue_name=None,
            guest_count=wedding.guest_count,
            total_budget=wedding.total_budget,
            days_remaining=calculate_days_remaining(wedding.wedding_date)
        )
    except Exception as e:
        logger.error(f"Error creating wedding: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/weddings/{wedding_id}", response_model=WeddingResponse)
def get_wedding(wedding_id: str):
    """Get wedding details"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM weddings WHERE id = ?", (wedding_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Wedding not found")
            
            wedding_date = datetime.strptime(row["wedding_date"], "%Y-%m-%d").date()
            
            return WeddingResponse(
                id=row["id"],
                groom_name=row["groom_name"],
                bride_name=row["bride_name"],
                wedding_date=wedding_date,
                venue_name=row["venue_name"],
                guest_count=row["guest_count"],
                total_budget=row["total_budget"],
                days_remaining=calculate_days_remaining(wedding_date)
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting wedding: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.put("/weddings/{wedding_id}")
def update_wedding(wedding_id: str, update: WeddingUpdate):
    """Update wedding details (EDITABLE)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Build dynamic update query
            updates = []
            values = []
            
            if update.groom_name is not None:
                updates.append("groom_name = ?")
                values.append(update.groom_name)
            if update.bride_name is not None:
                updates.append("bride_name = ?")
                values.append(update.bride_name)
            if update.wedding_date is not None:
                updates.append("wedding_date = ?")
                values.append(update.wedding_date)
            if update.venue_name is not None:
                updates.append("venue_name = ?")
                values.append(update.venue_name)
            if update.total_budget is not None:
                updates.append("total_budget = ?")
                values.append(update.total_budget)
            if update.guest_count is not None:
                updates.append("guest_count = ?")
                values.append(update.guest_count)
            
            updates.append("updated_at = CURRENT_TIMESTAMP")
            values.append(wedding_id)
            
            if updates:
                query = f"UPDATE weddings SET {', '.join(updates)} WHERE id = ?"
                cursor.execute(query, values)
                conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Wedding not found")
        
        logger.info(f"Wedding updated: {wedding_id}")
        return {"message": "Wedding updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating wedding: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/weddings/{wedding_id}")
def delete_wedding(wedding_id: str):
    """Delete wedding"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM weddings WHERE id = ?", (wedding_id,))
            conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Wedding not found")
        
        logger.info(f"Wedding deleted: {wedding_id}")
        return {"message": "Wedding deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting wedding: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== DASHBOARD ====================

@app.get("/weddings/{wedding_id}/dashboard", response_model=DashboardResponse)
def get_dashboard(wedding_id: str):
    """Get dashboard data with improved error handling"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get wedding info
            cursor.execute("SELECT * FROM weddings WHERE id = ?", (wedding_id,))
            wedding = cursor.fetchone()
            if not wedding:
                raise HTTPException(status_code=404, detail="Wedding not found")
            
            wedding_date = datetime.strptime(wedding["wedding_date"], "%Y-%m-%d").date()
            days_remaining = calculate_days_remaining(wedding_date)
            
            # Get budget totals
            cursor.execute("""
                SELECT SUM(planned_amount) as total_planned, SUM(actual_amount) as total_actual
                FROM budget_categories WHERE wedding_id = ?
            """, (wedding_id,))
            budget = cursor.fetchone()
            
            total_planned = budget["total_planned"] or wedding["total_budget"]
            total_actual = budget["total_actual"] or 0
            remaining = total_planned - total_actual
            budget_percentage = int((total_actual / total_planned * 100)) if total_planned > 0 else 0
            
            # Get task counts
            cursor.execute("""
                SELECT 
                    COUNT(*) as total_tasks,
                    SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed_tasks,
                    SUM(CASE WHEN is_urgent = 1 AND is_completed = 0 THEN 1 ELSE 0 END) as urgent_tasks
                FROM tasks WHERE wedding_id = ?
            """, (wedding_id,))
            tasks = cursor.fetchone()
            
            total_tasks = tasks["total_tasks"] or 1
            completed_tasks = tasks["completed_tasks"] or 0
            urgent_tasks = tasks["urgent_tasks"] or 0
            control_percentage = int((completed_tasks / total_tasks * 100))
            
            logger.info(f"Dashboard loaded for wedding: {wedding_id}")
            
            return DashboardResponse(
                days_remaining=days_remaining,
                control_percentage=control_percentage,
                tasks_completed=completed_tasks,
                tasks_urgent=urgent_tasks,
                tasks_total=total_tasks,
                budget_planned=total_planned,
                budget_actual=total_actual,
                budget_remaining=remaining,
                budget_percentage=budget_percentage
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== BUDGET ====================

@app.get("/weddings/{wedding_id}/budget")
def get_budget_categories(wedding_id: str):
    """Get all budget categories with improved error handling"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Verify wedding exists
            cursor.execute("SELECT id FROM weddings WHERE id = ?", (wedding_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Wedding not found")
            
            cursor.execute("""
                SELECT * FROM budget_categories 
                WHERE wedding_id = ?
                ORDER BY planned_amount DESC
            """, (wedding_id,))
            
            categories = []
            for row in cursor.fetchall():
                percentage = int((row["actual_amount"] / row["planned_amount"] * 100)) if row["planned_amount"] > 0 else 0
                categories.append({
                    "id": row["id"],
                    "name": row["name"],
                    "icon": row["icon"],
                    "planned_amount": row["planned_amount"],
                    "actual_amount": row["actual_amount"],
                    "percentage_spent": percentage,
                    "notes": row["notes"]
                })
            
            logger.info(f"Budget categories loaded for wedding: {wedding_id}")
            return categories
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading budget: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/weddings/{wedding_id}/budget")
def create_budget_category(wedding_id: str, category: BudgetCategoryCreate):
    """Add a new budget category"""
    try:
        cat_id = generate_id()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO budget_categories (id, wedding_id, name, icon, planned_amount, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (cat_id, wedding_id, category.name, category.icon, category.planned_amount, category.notes))
            conn.commit()
        
        logger.info(f"Budget category created: {cat_id}")
        return {"id": cat_id, "message": "Category created"}
    except Exception as e:
        logger.error(f"Error creating category: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.put("/budget/{category_id}")
def update_budget_category(category_id: str, update: BudgetCategoryUpdate):
    """Update budget category (EDITABLE)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            updates = []
            values = []
            
            if update.name is not None:
                updates.append("name = ?")
                values.append(update.name)
            if update.planned_amount is not None:
                updates.append("planned_amount = ?")
                values.append(update.planned_amount)
            if update.actual_amount is not None:
                updates.append("actual_amount = ?")
                values.append(update.actual_amount)
            if update.notes is not None:
                updates.append("notes = ?")
                values.append(update.notes)
            
            values.append(category_id)
            
            if updates:
                query = f"UPDATE budget_categories SET {', '.join(updates)} WHERE id = ?"
                cursor.execute(query, values)
                conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Category not found")
        
        logger.info(f"Budget category updated: {category_id}")
        return {"message": "Category updated"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating category: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/budget/{category_id}")
def delete_budget_category(category_id: str):
    """Delete budget category"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM budget_categories WHERE id = ?", (category_id,))
            conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Category not found")
        
        logger.info(f"Budget category deleted: {category_id}")
        return {"message": "Category deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting category: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== VENDOR BOOKINGS ====================

@app.get("/weddings/{wedding_id}/bookings")
def get_vendor_bookings(wedding_id: str):
    """Get couple's vendor bookings"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM vendor_bookings 
                WHERE wedding_id = ?
                ORDER BY created_at DESC
            """, (wedding_id,))
            
            bookings = []
            for row in cursor.fetchall():
                bookings.append({
                    "id": row["id"],
                    "vendor_id": row["vendor_id"],
                    "category_id": row["category_id"],
                    "vendor_name": row["vendor_name"],
                    "amount": row["amount"],
                    "deposit_paid": row["deposit_paid"],
                    "payment_due_date": row["payment_due_date"],
                    "status": row["status"],
                    "notes": row["notes"]
                })
            
            logger.info(f"Vendor bookings loaded for wedding: {wedding_id}")
            return bookings
    except Exception as e:
        logger.error(f"Error loading bookings: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/weddings/{wedding_id}/bookings")
def create_vendor_booking(wedding_id: str, booking: VendorBookingCreate):
    """Book a vendor"""
    try:
        booking_id = generate_id()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Insert booking
            cursor.execute("""
                INSERT INTO vendor_bookings 
                (id, wedding_id, vendor_id, category_id, vendor_name, amount, deposit_paid, payment_due_date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (booking_id, wedding_id, booking.vendor_id, booking.category_id, 
                  booking.vendor_name, booking.amount, booking.deposit_paid, 
                  booking.payment_due_date, booking.notes))
            
            # Update category actual amount
            cursor.execute("""
                UPDATE budget_categories 
                SET actual_amount = actual_amount + ?
                WHERE id = ?
            """, (booking.amount, booking.category_id))
            
            conn.commit()
        
        logger.info(f"Vendor booking created: {booking_id}")
        return {"id": booking_id, "message": "Vendor booked successfully"}
    except Exception as e:
        logger.error(f"Error creating booking: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.put("/bookings/{booking_id}")
def update_vendor_booking(booking_id: str, update: VendorBookingUpdate):
    """Update vendor booking (EDITABLE)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get old amount first
            cursor.execute("SELECT amount, category_id FROM vendor_bookings WHERE id = ?", (booking_id,))
            old_booking = cursor.fetchone()
            if not old_booking:
                raise HTTPException(status_code=404, detail="Booking not found")
            
            old_amount = old_booking["amount"]
            category_id = old_booking["category_id"]
            
            updates = []
            values = []
            new_amount = old_amount
            
            if update.vendor_name is not None:
                updates.append("vendor_name = ?")
                values.append(update.vendor_name)
            if update.amount is not None:
                updates.append("amount = ?")
                values.append(update.amount)
                new_amount = update.amount
            if update.deposit_paid is not None:
                updates.append("deposit_paid = ?")
                values.append(update.deposit_paid)
            if update.payment_due_date is not None:
                updates.append("payment_due_date = ?")
                values.append(update.payment_due_date)
            if update.status is not None:
                updates.append("status = ?")
                values.append(update.status)
            if update.notes is not None:
                updates.append("notes = ?")
                values.append(update.notes)
            
            values.append(booking_id)
            
            if updates:
                query = f"UPDATE vendor_bookings SET {', '.join(updates)} WHERE id = ?"
                cursor.execute(query, values)
                
                # Update category actual amount if amount changed
                if new_amount != old_amount:
                    diff = new_amount - old_amount
                    cursor.execute("""
                        UPDATE budget_categories 
                        SET actual_amount = actual_amount + ?
                        WHERE id = ?
                    """, (diff, category_id))
                
                conn.commit()
        
        logger.info(f"Vendor booking updated: {booking_id}")
        return {"message": "Booking updated"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating booking: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/bookings/{booking_id}")
def delete_vendor_booking(booking_id: str):
    """Delete vendor booking"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get amount and category first
            cursor.execute("SELECT amount, category_id FROM vendor_bookings WHERE id = ?", (booking_id,))
            booking = cursor.fetchone()
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found")
            
            # Delete booking
            cursor.execute("DELETE FROM vendor_bookings WHERE id = ?", (booking_id,))
            
            # Update category actual amount
            cursor.execute("""
                UPDATE budget_categories 
                SET actual_amount = actual_amount - ?
                WHERE id = ?
            """, (booking["amount"], booking["category_id"]))
            
            conn.commit()
        
        logger.info(f"Vendor booking deleted: {booking_id}")
        return {"message": "Booking deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting booking: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== TASKS ====================

@app.get("/weddings/{wedding_id}/tasks")
def get_tasks(wedding_id: str, timeline_period: Optional[str] = None):
    """Get all tasks"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            if timeline_period:
                cursor.execute("""
                    SELECT * FROM tasks 
                    WHERE wedding_id = ? AND timeline_period = ?
                    ORDER BY is_urgent DESC, due_date ASC
                """, (wedding_id, timeline_period))
            else:
                cursor.execute("""
                    SELECT * FROM tasks 
                    WHERE wedding_id = ?
                    ORDER BY is_urgent DESC, timeline_period, due_date ASC
                """, (wedding_id,))
            
            tasks = []
            for row in cursor.fetchall():
                tasks.append({
                    "id": row["id"],
                    "title": row["title"],
                    "description": row["description"],
                    "timeline_period": row["timeline_period"],
                    "due_date": row["due_date"],
                    "is_completed": bool(row["is_completed"]),
                    "is_urgent": bool(row["is_urgent"])
                })
            
            logger.info(f"Tasks loaded for wedding: {wedding_id}")
            return tasks
    except Exception as e:
        logger.error(f"Error loading tasks: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/weddings/{wedding_id}/tasks")
def create_task(wedding_id: str, task: TaskCreate):
    """Create a new task"""
    try:
        task_id = generate_id()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO tasks (id, wedding_id, title, description, timeline_period, due_date, is_urgent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (task_id, wedding_id, task.title, task.description, 
                  task.timeline_period, task.due_date, task.is_urgent))
            conn.commit()
        
        logger.info(f"Task created: {task_id}")
        return {"id": task_id, "message": "Task created"}
    except Exception as e:
        logger.error(f"Error creating task: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.put("/tasks/{task_id}")
def update_task(task_id: str, update: TaskUpdate):
    """Update task (EDITABLE)"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            updates = []
            values = []
            
            if update.title is not None:
                updates.append("title = ?")
                values.append(update.title)
            if update.description is not None:
                updates.append("description = ?")
                values.append(update.description)
            if update.due_date is not None:
                updates.append("due_date = ?")
                values.append(update.due_date)
            if update.is_urgent is not None:
                updates.append("is_urgent = ?")
                values.append(update.is_urgent)
            
            values.append(task_id)
            
            if updates:
                query = f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?"
                cursor.execute(query, values)
                conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Task not found")
        
        logger.info(f"Task updated: {task_id}")
        return {"message": "Task updated"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.patch("/tasks/{task_id}/complete")
def toggle_task_completion(task_id: str):
    """Toggle task completion"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get current state
            cursor.execute("SELECT is_completed FROM tasks WHERE id = ?", (task_id,))
            task = cursor.fetchone()
            if not task:
                raise HTTPException(status_code=404, detail="Task not found")
            
            new_state = not bool(task["is_completed"])
            completed_at = "CURRENT_TIMESTAMP" if new_state else "NULL"
            
            cursor.execute(f"""
                UPDATE tasks 
                SET is_completed = ?, completed_at = {completed_at}
                WHERE id = ?
            """, (new_state, task_id))
            conn.commit()
        
        logger.info(f"Task toggled: {task_id} -> {new_state}")
        return {"message": "Task updated", "is_completed": new_state}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error toggling task: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    """Delete task"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            conn.commit()
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Task not found")
        
        logger.info(f"Task deleted: {task_id}")
        return {"message": "Task deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== VENDORS MARKETPLACE ====================

@app.get("/vendors")
def search_vendors(category: Optional[str] = None, location: Optional[str] = None):
    """Search vendors in marketplace"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            query = "SELECT * FROM vendors WHERE 1=1"
            params = []
            
            if category:
                query += " AND category = ?"
                params.append(category)
            if location:
                query += " AND location LIKE ?"
                params.append(f"%{location}%")
            
            query += " ORDER BY rating DESC, review_count DESC"
            
            cursor.execute(query, params)
            
            vendors = []
            for row in cursor.fetchall():
                vendors.append({
                    "id": row["id"],
                    "business_name": row["business_name"],
                    "category": row["category"],
                    "description": row["description"],
                    "price_range_min": row["price_range_min"],
                    "price_range_max": row["price_range_max"],
                    "location": row["location"],
                    "phone": row["phone"],
                    "email": row["email"],
                    "rating": row["rating"],
                    "review_count": row["review_count"],
                    "is_verified": bool(row["is_verified"])
                })
            
            return vendors
    except Exception as e:
        logger.error(f"Error searching vendors: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/vendors/{vendor_id}")
def get_vendor_profile(vendor_id: str):
    """Get vendor profile"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM vendors WHERE id = ?", (vendor_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Vendor not found")
            
            return {
                "id": row["id"],
                "business_name": row["business_name"],
                "category": row["category"],
                "description": row["description"],
                "price_range_min": row["price_range_min"],
                "price_range_max": row["price_range_max"],
                "location": row["location"],
                "phone": row["phone"],
                "email": row["email"],
                "website": row["website"],
                "instagram": row["instagram"],
                "rating": row["rating"],
                "review_count": row["review_count"],
                "is_verified": bool(row["is_verified"])
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting vendor: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/vendors")
def create_vendor(vendor: VendorCreate):
    """Create vendor profile (for vendors)"""
    try:
        vendor_id = generate_id()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO vendors 
                (id, business_name, category, description, price_range_min, price_range_max, 
                 location, phone, email, website, instagram)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (vendor_id, vendor.business_name, vendor.category, vendor.description,
                  vendor.price_range_min, vendor.price_range_max, vendor.location,
                  vendor.phone, vendor.email, vendor.website, vendor.instagram))
            conn.commit()
        
        logger.info(f"Vendor created: {vendor_id}")
        return {"id": vendor_id, "message": "Vendor created"}
    except Exception as e:
        logger.error(f"Error creating vendor: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== WEBSOCKET (Real-time) ====================

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, wedding_id: str):
        await websocket.accept()
        if wedding_id not in self.active_connections:
            self.active_connections[wedding_id] = []
        self.active_connections[wedding_id].append(websocket)
        logger.info(f"WebSocket connected for wedding: {wedding_id}")

    def disconnect(self, websocket: WebSocket, wedding_id: str):
        if wedding_id in self.active_connections:
            self.active_connections[wedding_id].remove(websocket)
        logger.info(f"WebSocket disconnected for wedding: {wedding_id}")

    async def broadcast(self, message: str, wedding_id: str):
        if wedding_id in self.active_connections:
            for connection in self.active_connections[wedding_id]:
                try:
                    await connection.send_text(message)
                except:
                    pass

manager = ConnectionManager()

@app.websocket("/ws/wedding/{wedding_id}")
async def websocket_endpoint(websocket: WebSocket, wedding_id: str):
    """WebSocket for real-time updates"""
    await manager.connect(websocket, wedding_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast to all connected clients
            await manager.broadcast(data, wedding_id)
    except WebSocketDisconnect:
        manager.disconnect(websocket, wedding_id)

# ==================== STARTUP & SHUTDOWN ====================

@app.on_event("startup")
async def startup_event():
    logger.info("🚀 Wedding Elite V2.0 API Starting...")
    logger.info("✅ Database initialized")
    logger.info("✅ Server ready")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("👋 Wedding Elite V2.0 API Shutting down...")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)