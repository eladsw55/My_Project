"""
Wedding Elite V2.0 - Backend API
Full Production Version with Auto-Seed for Render
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, date
import sqlite3
from contextlib import contextmanager
import uuid

app = FastAPI(
    title="Wedding Elite V2.0 API",
    description="Complete wedding planning platform",
    version="2.0.0"
)

# CORS Configuration - מאפשר ל-GitHub Pages להתחבר
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== DATABASE SETUP ====================
DATABASE = "wedding_elite_v2.db"

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_database():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # טבלת חתונות
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS weddings (
                id TEXT PRIMARY KEY,
                groom_name TEXT,
                bride_name TEXT,
                wedding_date DATE,
                total_budget REAL DEFAULT 165000,
                guest_count INTEGER DEFAULT 400
            )
        """)
        
        # טבלת קטגוריות תקציב
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS budget_categories (
                id TEXT PRIMARY KEY,
                wedding_id TEXT,
                name TEXT,
                icon TEXT,
                planned_amount REAL,
                actual_amount REAL DEFAULT 0,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id)
            )
        """)
        
        # טבלת משימות
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                wedding_id TEXT,
                title TEXT,
                is_urgent INTEGER DEFAULT 0,
                is_completed INTEGER DEFAULT 0,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id)
            )
        """)

        # טבלת ספקים שהוזמנו
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vendors (
                id TEXT PRIMARY KEY,
                wedding_id TEXT,
                name TEXT,
                category TEXT,
                amount REAL,
                FOREIGN KEY (wedding_id) REFERENCES weddings (id)
            )
        """)
        
        conn.commit()

# ==================== AUTO-SEED (יצירת נתונים אוטומטית) ====================
# פונקציה זו מבטיחה שתמיד תהיה חתונה אחת במערכת, גם אם השרת מתאפס
DEMO_WEDDING_ID = "demo-wedding-1"

def seed_data():
    with get_db() as conn:
        cursor = conn.cursor()
        # בדיקה אם החתונה קיימת
        cursor.execute("SELECT id FROM weddings WHERE id = ?", (DEMO_WEDDING_ID,))
        if not cursor.fetchone():
            print("Creating Demo Wedding...")
            # יצירת חתונה
            cursor.execute("""
                INSERT INTO weddings (id, groom_name, bride_name, wedding_date, total_budget)
                VALUES (?, ?, ?, ?, ?)
            """, (DEMO_WEDDING_ID, "יוסי", "חן", "2026-08-15", 165000))
            
            # יצירת קטגוריות ברירת מחדל
            categories = [
                ("1", "אולם ואירוח", "🏛️", 90000),
                ("2", "צילום ווידאו", "📸", 15000),
                ("3", "מוזיקה ובידור", "🎵", 12000),
                ("4", "פרחים ועיצוב", "💐", 10500),
                ("5", "לבוש ויופי", "💄", 9000)
            ]
            for cat in categories:
                cursor.execute("""
                    INSERT INTO budget_categories (id, wedding_id, name, icon, planned_amount)
                    VALUES (?, ?, ?, ?, ?)
                """, (cat[0], DEMO_WEDDING_ID, cat[1], cat[2], cat[3]))
            
            # יצירת משימות ברירת מחדל
            tasks = [
                ("1", "לסגור אולם", 1, 0),
                ("2", "לקנות טבעות", 0, 0),
                ("3", "לשלוח הזמנות", 1, 0)
            ]
            for task in tasks:
                cursor.execute("""
                    INSERT INTO tasks (id, wedding_id, title, is_urgent, is_completed)
                    VALUES (?, ?, ?, ?, ?)
                """, (task[0], DEMO_WEDDING_ID, task[1], task[2], task[3]))
                
            conn.commit()

# הפעלה בעת טעינת הקובץ
init_database()
seed_data()

# ==================== MODELS ====================

class TaskModel(BaseModel):
    title: str
    is_urgent: bool = False
    is_completed: bool = False

class BudgetUpdate(BaseModel):
    total: float

class VendorModel(BaseModel):
    name: str
    category: str
    amount: float

# ==================== API ENDPOINTS ====================

@app.get("/")
def root():
    return {"status": "running", "wedding_id": DEMO_WEDDING_ID}

# --- נתוני דשבורד וכללי ---
@app.get("/weddings/{wedding_id}/dashboard")
def get_dashboard(wedding_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        
        # פרטי חתונה
        cursor.execute("SELECT * FROM weddings WHERE id = ?", (wedding_id,))
        wedding = cursor.fetchone()
        if not wedding:
            # אם החתונה נעלמה (בגלל ריסט לשרת), ניצור אותה מחדש
            seed_data()
            cursor.execute("SELECT * FROM weddings WHERE id = ?", (wedding_id,))
            wedding = cursor.fetchone()

        # חישוב ימים
        w_date = datetime.strptime(wedding["wedding_date"], "%Y-%m-%d").date()
        days_left = (w_date - datetime.now().date()).days
        
        # סיכום משימות
        cursor.execute("SELECT COUNT(*) as total, SUM(is_completed) as done, SUM(is_urgent) as urgent FROM tasks WHERE wedding_id = ?", (wedding_id,))
        tasks = cursor.fetchone()
        
        # סיכום תקציב
        cursor.execute("SELECT SUM(actual_amount) as spent FROM budget_categories WHERE wedding_id = ?", (wedding_id,))
        spent_row = cursor.fetchone()
        spent = spent_row["spent"] if spent_row["spent"] else 0
        
        return {
            "groom_name": wedding["groom_name"],
            "bride_name": wedding["bride_name"],
            "days_left": max(0, days_left),
            "date": wedding["wedding_date"],
            "total_budget": wedding["total_budget"],
            "total_spent": spent,
            "tasks_total": tasks["total"],
            "tasks_done": tasks["done"] if tasks["done"] else 0,
            "tasks_urgent": tasks["urgent"] if tasks["urgent"] else 0
        }

@app.put("/weddings/{wedding_id}/budget")
def update_budget_total(wedding_id: str, budget: BudgetUpdate):
    with get_db() as conn:
        conn.execute("UPDATE weddings SET total_budget = ? WHERE id = ?", (budget.total, wedding_id))
        conn.commit()
    return {"message": "Budget updated"}

# --- קטגוריות תקציב ---
@app.get("/weddings/{wedding_id}/categories")
def get_categories(wedding_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM budget_categories WHERE wedding_id = ?", (wedding_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

# --- משימות ---
@app.get("/weddings/{wedding_id}/tasks")
def get_tasks(wedding_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE wedding_id = ?", (wedding_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

@app.post("/weddings/{wedding_id}/tasks")
def add_task(wedding_id: str, task: TaskModel):
    new_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute("""
            INSERT INTO tasks (id, wedding_id, title, is_urgent, is_completed)
            VALUES (?, ?, ?, ?, ?)
        """, (new_id, wedding_id, task.title, int(task.is_urgent), 0))
        conn.commit()
    return {"id": new_id, "message": "Task created"}

@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    return {"message": "Deleted"}

@app.put("/tasks/{task_id}/toggle")
def toggle_task(task_id: str):
    with get_db() as conn:
        # שליפת מצב קיים
        cursor = conn.cursor()
        cursor.execute("SELECT is_completed FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        if row:
            new_val = 0 if row["is_completed"] else 1
            conn.execute("UPDATE tasks SET is_completed = ? WHERE id = ?", (new_val, task_id))
            conn.commit()
    return {"message": "Toggled"}

# --- ספקים ---
@app.get("/weddings/{wedding_id}/vendors")
def get_vendors(wedding_id: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vendors WHERE wedding_id = ?", (wedding_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

@app.post("/weddings/{wedding_id}/vendors")
def add_vendor(wedding_id: str, vendor: VendorModel):
    new_id = str(uuid.uuid4())
    with get_db() as conn:
        # הוספת הספק
        conn.execute("""
            INSERT INTO vendors (id, wedding_id, name, category, amount)
            VALUES (?, ?, ?, ?, ?)
        """, (new_id, wedding_id, vendor.name, vendor.category, vendor.amount))
        
        # עדכון אוטומטי של "הוצא בפועל" בקטגוריה המתאימה
        # חיפוש הקטגוריה לפי שם (פשוט לצורך הדוגמה)
        conn.execute("""
            UPDATE budget_categories 
            SET actual_amount = actual_amount + ? 
            WHERE wedding_id = ? AND name LIKE ?
        """, (vendor.amount, wedding_id, f"%{vendor.category}%"))
        
        conn.commit()
    return {"id": new_id, "message": "Vendor added"}

@app.delete("/vendors/{vendor_id}")
def delete_vendor(vendor_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM vendors WHERE id = ?", (vendor_id,))
        conn.commit()
    return {"message": "Vendor deleted"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)