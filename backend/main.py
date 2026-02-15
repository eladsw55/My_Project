import sqlite3
import json
from flask import Flask, jsonify, request, Response
import os

app = Flask(__name__)
DB_FILE = "wedding_planner.db"

# --- Database Setup ---
def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        # Settings & Budget
        cursor.execute('''CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY, total_budget REAL DEFAULT 0, 
            groom_name TEXT, bride_name TEXT, wedding_date TEXT
        )''')
        # Initialize settings if empty
        cursor.execute('SELECT count(*) FROM settings')
        if cursor.fetchone()[0] == 0:
            cursor.execute('INSERT INTO settings (total_budget, groom_name, bride_name, wedding_date) VALUES (100000, "חתן", "כלה", "2026-01-01")')
        
        # Guests
        cursor.execute('''CREATE TABLE IF NOT EXISTS guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, side TEXT, 
            invite_status TEXT, gift_amount REAL DEFAULT 0, total_people INTEGER DEFAULT 1
        )''')
        
        # Expenses/Vendors
        cursor.execute('''CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, category TEXT,
            estimated_cost REAL, actual_cost REAL, paid_amount REAL
        )''')
        
        # Tasks
        cursor.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, 
            deadline TEXT, is_completed INTEGER DEFAULT 0
        )''')
        conn.commit()

# --- Routes ---

@app.route('/')
def index():
    # Reads index.html directly from the current folder
    with open('index.html', 'r', encoding='utf-8') as f:
        return f.read()

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard_data():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Fetch Settings
    settings = dict(c.execute('SELECT * FROM settings').fetchone())
    
    # Fetch Summaries
    total_spent = c.execute('SELECT SUM(paid_amount) FROM expenses').fetchone()[0] or 0
    total_guests = c.execute('SELECT SUM(total_people) FROM guests').fetchone()[0] or 0
    total_gifts = c.execute('SELECT SUM(gift_amount) FROM guests').fetchone()[0] or 0
    tasks_count = c.execute('SELECT COUNT(*) FROM tasks WHERE is_completed=0').fetchone()[0] or 0
    
    return jsonify({
        "settings": settings,
        "summary": {
            "total_spent": total_spent,
            "total_guests": total_guests,
            "total_gifts": total_gifts,
            "pending_tasks": tasks_count
        }
    })

# --- Budget & Expenses API ---
@app.route('/api/expenses', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_expenses():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    if request.method == 'GET':
        expenses = [dict(row) for row in c.execute('SELECT * FROM expenses ORDER BY id DESC')]
        return jsonify(expenses)
    
    elif request.method == 'POST':
        data = request.json
        c.execute('INSERT INTO expenses (title, category, estimated_cost, actual_cost, paid_amount) VALUES (?,?,?,?,?)',
                  (data['title'], data['category'], data['estimated_cost'], data.get('actual_cost',0), data.get('paid_amount',0)))
        conn.commit()
        return jsonify({"status": "success", "id": c.lastrowid})

    elif request.method == 'PUT':
        data = request.json
        c.execute('UPDATE expenses SET title=?, category=?, estimated_cost=?, actual_cost=?, paid_amount=? WHERE id=?',
                  (data['title'], data['category'], data['estimated_cost'], data['actual_cost'], data['paid_amount'], data['id']))
        conn.commit()
        return jsonify({"status": "updated"})

    elif request.method == 'DELETE':
        ex_id = request.args.get('id')
        c.execute('DELETE FROM expenses WHERE id=?', (ex_id,))
        conn.commit()
        return jsonify({"status": "deleted"})

# --- Guest API ---
@app.route('/api/guests', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_guests():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    if request.method == 'GET':
        guests = [dict(row) for row in c.execute('SELECT * FROM guests ORDER BY name')]
        return jsonify(guests)

    elif request.method == 'POST':
        data = request.json
        c.execute('INSERT INTO guests (name, side, invite_status, gift_amount, total_people) VALUES (?,?,?,?,?)',
                  (data['name'], data['side'], data['invite_status'], data.get('gift_amount', 0), data.get('total_people', 1)))
        conn.commit()
        return jsonify({"status": "success", "id": c.lastrowid})

    elif request.method == 'DELETE':
        g_id = request.args.get('id')
        c.execute('DELETE FROM guests WHERE id=?', (g_id,))
        conn.commit()
        return jsonify({"status": "deleted"})

# --- Settings API ---
@app.route('/api/settings', methods=['POST'])
def update_settings():
    data = request.json
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('UPDATE settings SET total_budget=?, groom_name=?, bride_name=?, wedding_date=?',
              (data['total_budget'], data['groom_name'], data['bride_name'], data['wedding_date']))
    conn.commit()
    return jsonify({"status": "updated"})

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)