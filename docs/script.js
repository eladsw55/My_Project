/**
 * Wedding Planner Premium Logic
 * Author: Elad (Senior Full Stack Refactor)
 */

const WeddingApp = {
    // --- Configuration ---
    DB_KEY: 'wedding_app_db_v2', 
    
    // --- State ---
    data: {
        settings: {
            total_budget: 100000,
            groom_name: "החתן",
            bride_name: "הכלה",
            wedding_date: "2026-06-15"
        },
        expenses: [],
        guests: []
    },

    // --- Initialization ---
    init: function() {
        console.log("Initializing WeddingApp...");
        this.loadData();
        this.cacheDOM();
        this.bindEvents();
        this.renderDashboard();
        this.startCountdown();
    },

    // --- DOM Caching ---
    cacheDOM: function() {
        this.dom = {
            namesDisplay: document.getElementById('namesDisplay'),
            dateDisplay: document.getElementById('countdownDisplay'),
            budgetTotal: document.getElementById('budgetTotal'),
            budgetSpent: document.getElementById('budgetSpent'),
            budgetLeft: document.getElementById('budgetLeft'),
            budgetProgress: document.getElementById('budgetProgress'),
            totalGuests: document.getElementById('totalGuests'),
            totalGifts: document.getElementById('totalGifts'),
            expensesList: document.getElementById('expensesList'),
            guestsList: document.getElementById('guestsList'),
            modal: document.getElementById('itemModal'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalActionBtn: document.getElementById('modalActionBtn'),
            modalCloseBtn: document.getElementById('modalCloseBtn'),
            guestSearch: document.getElementById('guestSearch'),
            
            // Buttons
            btnOpenSettings: document.getElementById('btnOpenSettings'),
            btnAddExpense: document.getElementById('btnAddExpense'),
            btnAddGuest: document.getElementById('btnAddGuest'),
            navItems: document.querySelectorAll('.nav-item')
        };
    },

    // --- Event Binding (The Professional Way) ---
    bindEvents: function() {
        // Navigation
        this.dom.navItems.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = btn.closest('.nav-item').dataset.tab;
                this.switchTab(tabId);
            });
        });

        // Modals Triggers
        this.dom.btnOpenSettings.addEventListener('click', () => this.openSettingsModal());
        this.dom.btnAddExpense.addEventListener('click', () => this.openExpenseModal());
        this.dom.btnAddGuest.addEventListener('click', () => this.openGuestModal());

        // Close Modal
        this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
        window.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) this.closeModal();
        });

        // Search
        this.dom.guestSearch.addEventListener('keyup', (e) => this.renderGuests(e.target.value));
    },

    // --- Storage System ---
    loadData: function() {
        try {
            const saved = localStorage.getItem(this.DB_KEY);
            if (saved) {
                this.data = JSON.parse(saved);
            } else {
                this.saveData(); // Init defaults
            }
        } catch (e) {
            console.error("Storage Error:", e);
        }
    },

    saveData: function() {
        localStorage.setItem(this.DB_KEY, JSON.stringify(this.data));
        this.renderDashboard(); 
    },

    // --- Core Logic ---
    renderDashboard: function() {
        const s = this.data.settings;
        
        // Safe calculations
        const totalSpent = this.data.expenses.reduce((acc, curr) => acc + Number(curr.paid_amount || 0), 0);
        const totalGuests = this.data.guests.reduce((acc, curr) => acc + Number(curr.total_people || 1), 0);
        const totalGifts = this.data.guests.reduce((acc, curr) => acc + Number(curr.gift || 0), 0);
        const remaining = s.total_budget - totalSpent;

        // Update UI
        this.dom.namesDisplay.textContent = `${s.groom_name} & ${s.bride_name}`;
        
        const fmt = (num) => `₪${Number(num).toLocaleString()}`;
        
        this.dom.budgetTotal.textContent = fmt(s.total_budget);
        this.dom.budgetSpent.textContent = fmt(totalSpent);
        this.dom.budgetLeft.textContent = fmt(remaining);
        this.dom.totalGuests.textContent = totalGuests;
        this.dom.totalGifts.textContent = fmt(totalGifts);

        this.dom.budgetLeft.style.color = remaining < 0 ? 'var(--danger)' : '#fff';

        const percent = (totalSpent / s.total_budget) * 100;
        this.dom.budgetProgress.style.width = `${Math.min(percent, 100)}%`;
        this.dom.budgetProgress.style.background = percent > 100 
            ? 'var(--danger)' 
            : 'linear-gradient(90deg, var(--accent-gold), #fde68a)';
    },

    startCountdown: function() {
        const updateTimer = () => {
            const weddingDate = new Date(this.data.settings.wedding_date).getTime();
            const now = new Date().getTime();
            const distance = weddingDate - now;

            if (distance < 0) {
                this.dom.dateDisplay.textContent = "מזל טוב! החתונה עברה 🎉";
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            
            this.dom.dateDisplay.textContent = `עוד ${days} ימים, ${hours}:${minutes} שעות`;
        };

        updateTimer();
        setInterval(updateTimer, 1000); // Bug fix: Interval needs to run repeatedly
    },

    // --- Navigation & Views ---
    switchTab: function(tabId) {
        document.querySelectorAll('.app-section').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');

        this.dom.navItems.forEach(el => el.classList.remove('active'));
        document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

        if (tabId === 'expenses') this.renderExpenses();
        if (tabId === 'guests') this.renderGuests();
    },

    // --- Expenses Methods ---
    renderExpenses: function() {
        const list = this.data.expenses;
        if (list.length === 0) {
            this.dom.expensesList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">אין הוצאות.</div>';
            return;
        }
        
        this.dom.expensesList.innerHTML = list.map((ex, index) => `
            <div class="list-item">
                <div class="item-details">
                    <h4>${ex.title}</h4>
                    <p>שולם: ₪${Number(ex.paid_amount).toLocaleString()} / עלות: ₪${Number(ex.estimated_cost).toLocaleString()}</p>
                </div>
                <div class="item-actions">
                    <span style="color:var(--accent-gold); font-weight:bold; margin-left:10px;">₪${Number(ex.estimated_cost).toLocaleString()}</span>
                    <button onclick="WeddingApp.deleteItem('expenses', ${index})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    },

    openExpenseModal: function() {
        this.dom.modalTitle.textContent = "הוסף הוצאה חדשה";
        this.dom.modalBody.innerHTML = `
            <input type="text" id="exTitle" class="app-input" placeholder="שם ההוצאה (למשל: צלם)">
            <input type="number" id="exCost" class="app-input" style="margin-top:10px" placeholder="עלות משוערת">
            <input type="number" id="exPaid" class="app-input" style="margin-top:10px" placeholder="כמה שולם כבר?">
        `;
        
        this.dom.modalActionBtn.onclick = () => {
            const title = document.getElementById('exTitle').value;
            const cost = document.getElementById('exCost').value;
            const paid = document.getElementById('exPaid').value;

            if (!title || !cost) { alert("חובה למלא שם ועלות"); return; }

            this.data.expenses.push({
                title: title,
                estimated_cost: cost,
                paid_amount: paid || 0
            });
            this.saveData();
            this.closeModal();
            this.renderExpenses();
        };
        this.showModal();
    },

    // --- Guests Methods ---
    renderGuests: function(filterText = '') {
        const list = this.data.guests.filter(g => g.name.includes(filterText));
        if (list.length === 0) {
            this.dom.guestsList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">אין אורחים ברשימה.</div>';
            return;
        }

        this.dom.guestsList.innerHTML = list.map((g, index) => `
            <div class="list-item">
                <div class="item-details">
                    <h4>${g.name} <span style="font-size:0.8rem; background:rgba(255,255,255,0.1); padding:2px 5px; border-radius:4px;">${g.total_people}</span></h4>
                    <p>${g.side} | ${g.status}</p>
                </div>
                <div class="item-actions">
                    ${g.gift > 0 ? `<span style="color:#10b981; margin-left:10px;">+₪${g.gift}</span>` : ''}
                    <button onclick="WeddingApp.deleteItem('guests', ${index})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    },

    openGuestModal: function() {
        this.dom.modalTitle.textContent = "הוסף אורח";
        this.dom.modalBody.innerHTML = `
            <input type="text" id="gName" class="app-input" placeholder="שם האורח">
            <select id="gSide" class="app-input" style="margin-top:10px; background:#1e293b; color:white;">
                <option value="חתן">צד חתן</option>
                <option value="כלה">צד כלה</option>
            </select>
            <input type="number" id="gCount" class="app-input" style="margin-top:10px" value="1" placeholder="כמות אנשים">
            <select id="gStatus" class="app-input" style="margin-top:10px; background:#1e293b; color:white;">
                <option value="טרם">טרם אישר</option>
                <option value="מגיע">מגיע</option>
                <option value="לא">לא מגיע</option>
            </select>
            <input type="number" id="gGift" class="app-input" style="margin-top:10px" placeholder="מתנה (אופציונלי)">
        `;
        
        this.dom.modalActionBtn.onclick = () => {
            this.data.guests.push({
                name: document.getElementById('gName').value,
                side: document.getElementById('gSide').value,
                total_people: document.getElementById('gCount').value,
                status: document.getElementById('gStatus').value,
                gift: document.getElementById('gGift').value || 0
            });
            this.saveData();
            this.closeModal();
            this.renderGuests();
        };
        this.showModal();
    },

    // --- Settings Modal ---
    openSettingsModal: function() {
        this.dom.modalTitle.textContent = "הגדרות חתונה";
        this.dom.modalBody.innerHTML = `
            <label class="text-muted">תקציב כולל:</label>
            <input type="number" id="sBudget" class="app-input" value="${this.data.settings.total_budget}">
            <label class="text-muted">שם חתן:</label>
            <input type="text" id="sGroom" class="app-input" value="${this.data.settings.groom_name}">
            <label class="text-muted">שם כלה:</label>
            <input type="text" id="sBride" class="app-input" value="${this.data.settings.bride_name}">
            <label class="text-muted">תאריך:</label>
            <input type="date" id="sDate" class="app-input" value="${this.data.settings.wedding_date}">
        `;
        
        this.dom.modalActionBtn.onclick = () => {
            this.data.settings.total_budget = document.getElementById('sBudget').value;
            this.data.settings.groom_name = document.getElementById('sGroom').value;
            this.data.settings.bride_name = document.getElementById('sBride').value;
            this.data.settings.wedding_date = document.getElementById('sDate').value;
            this.saveData();
            this.closeModal();
        };
        this.showModal();
    },

    // --- Helpers ---
    deleteItem: function(type, index) {
        if(confirm('למחוק פריט זה?')) {
            this.data[type].splice(index, 1);
            this.saveData();
            if(type === 'expenses') this.renderExpenses();
            if(type === 'guests') this.renderGuests();
        }
    },

    showModal: function() {
        this.dom.modal.style.display = 'flex';
        setTimeout(() => this.dom.modal.classList.add('show'), 10);
    },

    closeModal: function() {
        this.dom.modal.classList.remove('show');
        setTimeout(() => this.dom.modal.style.display = 'none', 300);
    }
};

// Start App when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    WeddingApp.init();
});