// Initialize Supabase client
const supabaseClient = supabase.createClient(
    'https://uoaoazppoqwohryxcena.supabase.co',
    'sb_publishable_uMdpDLkUQ0rx6d4_fWND2g_4Y5Gn3uq'
);

// Global variables
let expenses = [];
let incomes = [];
let trackingEntries = [];
let selectedSuiviMonth = new Date();
let categories = ['Alimentation', 'Logement', 'Transport', 'Loisirs', 'Santé', 'Finance', 'Téléphonie Internet', 'Investissement', 'Autres'];
let categoryChart = null;
let balanceChart = null;
let histChart = null;
let selectedHistYear = new Date().getFullYear();
let savingsSnapshots = [];
let savingsEvolutionChart = null;
let selectedEpargneMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let savingsGoal = parseFloat(localStorage.getItem('savings-goal') || 0);
let menus = [];
let mealPlan = [];

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + (day === 0 ? -6 : 1));
}

function weekKey(date) {
    const d = getMonday(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

let selectedMenuWeek = getMonday(new Date());

const savingsTypes = ['Livret A Matthieu', 'PEA Matthieu', 'CTO Matthieu', 'Livret A Marie', 'LDD Marie', 'PEA Marie', 'Autre'];
const savingsColors = {
    'Livret A Matthieu': '#3b82f6',
    'PEA Matthieu':      '#10b981',
    'CTO Matthieu':      '#f59e0b',
    'Livret A Marie':    '#ec4899',
    'LDD Marie':         '#f43f5e',
    'PEA Marie':         '#a855f7',
    'Autre':             '#94a3b8'
};
let editingExpenseId = null;
let expenseFilters = {
    category: '',
    account: '',
    beneficiary: ''
};

const colors = {
    'Alimentation': '#FF6B6B',
    'Logement': '#4ECDC4',
    'Transport': '#45B7D1',
    'Loisirs': '#FFA07A',
    'Santé': '#98D8C8',
    'Finance': '#F7DC6F',
    'Téléphonie Internet': '#BB8FCE',
    'Investissement': '#34D399',
    'Autres': '#95A5A6',
    'Reste disponible': '#10B981'
};

// #10 — XSS prevention
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Authentication functions
// #1 — checkUserOnLoad gère uniquement l'UI ; onAuthStateChange gère le chargement des données
async function checkUserOnLoad() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const loggedIn = !!session;
    document.getElementById('auth-container').classList.toggle('hidden', loggedIn);
    document.getElementById('logout-container').classList.toggle('hidden', !loggedIn);
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const loggedIn = !!session;
        document.getElementById('auth-container').classList.toggle('hidden', loggedIn);
        document.getElementById('logout-container').classList.toggle('hidden', !loggedIn);
        if (loggedIn) loadFromSupabase();
    } else if (event === 'SIGNED_OUT') {
        document.getElementById('auth-container').classList.remove('hidden');
        document.getElementById('logout-container').classList.add('hidden');
    }
});

checkUserOnLoad();

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorElement = document.getElementById('auth-error');

    if (!email || !password) {
        errorElement.textContent = "Veuillez remplir tous les champs.";
        errorElement.classList.remove('hidden');
        return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        errorElement.textContent = "Email ou mot de passe incorrect.";
        errorElement.classList.remove('hidden');
        console.error('Erreur de connexion:', error);
    }
}

async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) console.error('Erreur de déconnexion:', error);
}

// Utility functions
function getColorForCategory(category) {
    if (colors[category]) return colors[category];
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
        hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 360}, 65%, 60%)`;
}

// #7 — Gestion de l'état de chargement des boutons
function setButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
    btn.style.cursor = loading ? 'not-allowed' : '';
}

// Data loading — #8 : requêtes parallèles avec Promise.all
async function loadFromSupabase() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        console.log("Utilisateur non connecté.");
        return;
    }

    const [
        { data: supaExpenses, error: expError },
        { data: supaIncomes, error: incError },
        { data: supaTracking, error: trackError },
        { data: supaSnapshots, error: snapshotError },
        { data: supaMenus, error: menusError },
        { data: supaIngredients, error: ingredientsError },
        { data: supaMealPlan, error: mealPlanError }
    ] = await Promise.all([
        supabaseClient.from('expenses').select('*'),
        supabaseClient.from('incomes').select('*'),
        supabaseClient.from('suivi').select('*'),
        supabaseClient.from('epargne_snapshots').select('*').order('month', { ascending: true }),
        supabaseClient.from('menus').select('*').order('name'),
        supabaseClient.from('menu_ingredients').select('*').order('name'),
        supabaseClient.from('meal_plan').select('*'),
    ]);

    if (expError || incError || trackError || snapshotError || menusError || ingredientsError || mealPlanError) {
        console.error('Erreur Supabase:', expError || incError || trackError || snapshotError || menusError || ingredientsError || mealPlanError);
        return;
    }

    expenses = supaExpenses || [];
    incomes = supaIncomes || [];
    trackingEntries = supaTracking || [];
    savingsSnapshots = supaSnapshots || [];
    const rawMenus = supaMenus || [];
    const rawIngredients = supaIngredients || [];
    menus = rawMenus.map(m => ({ ...m, ingredients: rawIngredients.filter(i => i.menu_id === m.id) }));
    mealPlan = supaMealPlan || [];

    updateCategorySelect();
    render();
}

function updateCategorySelect() {
    const selects = [
        { id: 'expense-category', placeholder: 'Catégorie' },
        { id: 'suivi-category', placeholder: 'Catégorie' },
    ];
    selects.forEach(({ id, placeholder }) => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = `<option value="">${placeholder}</option>`;
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            select.appendChild(option);
        });
    });

    const filterCategory = document.getElementById('filter-category');
    if (filterCategory) {
        filterCategory.innerHTML = '<option value="">Toutes les catégories</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            filterCategory.appendChild(option);
        });
    }
}

// Expense management
function updateExpenseFilters() {
    expenseFilters.category = document.getElementById('filter-category').value;
    expenseFilters.account = document.getElementById('filter-account').value;
    expenseFilters.beneficiary = document.getElementById('filter-beneficiary').value;
    render();
}

function resetExpenseFilters() {
    expenseFilters = { category: '', account: '', beneficiary: '' };
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-account').value = '';
    document.getElementById('filter-beneficiary').value = '';
    render();
}

async function addExpense() {
    const name = document.getElementById('expense-name').value;
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const category = document.getElementById('expense-category').value;
    const account = document.getElementById('expense-account').value;
    const beneficiary = document.getElementById('expense-beneficiary').value;

    if (!name || !amount || !category || !account || !beneficiary) return;

    const recurring = document.getElementById('expense-recurring').checked;

    setButtonLoading('btn-add-expense', true);

    let error;
    if (editingExpenseId) {
        ({ error } = await supabaseClient
            .from('expenses')
            .update({ name, amount, category, account, beneficiary, recurring })
            .eq('id', editingExpenseId));
    } else {
        ({ error } = await supabaseClient
            .from('expenses')
            .insert([{ name, amount, category, account, beneficiary, recurring }]));
    }

    setButtonLoading('btn-add-expense', false);
    if (error) { console.error('Erreur dépense:', error); return; }

    cancelEditExpense();
    await loadFromSupabase();
}

function editExpense(id) {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;
    editingExpenseId = id;
    document.getElementById('expense-name').value = exp.name;
    document.getElementById('expense-amount').value = exp.amount;
    document.getElementById('expense-category').value = exp.category;
    document.getElementById('expense-account').value = exp.account;
    document.getElementById('expense-beneficiary').value = exp.beneficiary;
    document.getElementById('expense-recurring').checked = !!exp.recurring;
    document.getElementById('btn-add-expense').textContent = 'Mettre à jour';
    document.getElementById('btn-cancel-expense').classList.remove('hidden');
    document.getElementById('expense-name').focus();
    document.getElementById('expense-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditExpense() {
    editingExpenseId = null;
    document.getElementById('expense-name').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-category').value = '';
    document.getElementById('expense-account').value = '';
    document.getElementById('expense-beneficiary').value = '';
    document.getElementById('expense-recurring').checked = false;
    document.getElementById('btn-add-expense').textContent = 'Ajouter';
    document.getElementById('btn-cancel-expense').classList.add('hidden');
}

async function deleteExpense(id) {
    // #5 — Confirmation avant suppression
    if (!confirm('Supprimer cette dépense ?')) return;
    const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
    if (error) {
        console.error('Erreur suppression dépense:', error);
        return;
    }
    await loadFromSupabase();
}

// Income management
async function addIncome() {
    const name = document.getElementById('income-name').value;
    const amount = parseFloat(document.getElementById('income-amount').value);
    const person = document.getElementById('income-person').value;
    if (!name || !amount) return;

    setButtonLoading('btn-add-income', true);
    const { error } = await supabaseClient.from('incomes').insert([{ name, amount, person }]);
    setButtonLoading('btn-add-income', false);

    if (error) {
        console.error('Erreur ajout revenu:', error);
        return;
    }
    await loadFromSupabase();
    document.getElementById('income-name').value = '';
    document.getElementById('income-amount').value = '';
}

async function deleteIncome(id) {
    if (!confirm('Supprimer ce revenu ?')) return;
    const { error } = await supabaseClient.from('incomes').delete().eq('id', id);
    if (error) {
        console.error('Erreur suppression revenu:', error);
        return;
    }
    await loadFromSupabase();
}

// Statistics calculation
function getAccountStats() {
    const stats = {
        Matthieu: { income: 0, expenses: 0, investments: 0, sharedExpensesPaid: 0, individualExpensesFromCommon: 0 },
        Marie: { income: 0, expenses: 0, investments: 0, sharedExpensesPaid: 0, individualExpensesFromCommon: 0 },
        Commun: { income: 0, expenses: 0, investments: 0, sharedExpensesPaid: 0, individualExpensesFromCommon: 0 }
    };

    incomes.forEach(inc => {
        stats[inc.person].income += inc.amount;
    });

    expenses.forEach(exp => {
        if (exp.category === 'Investissement') {
            stats[exp.account].investments += exp.amount;
        } else {
            stats[exp.account].expenses += exp.amount;
        }

        if (exp.account !== 'Commun' && exp.beneficiary === 'Les deux' && exp.category !== 'Investissement') {
            stats[exp.account].sharedExpensesPaid += exp.amount;
        }

        if (exp.account === 'Commun' && exp.beneficiary !== 'Les deux' && exp.category !== 'Investissement') {
            stats[exp.beneficiary].individualExpensesFromCommon += exp.amount;
        }
    });

    return stats;
}

// Rendering functions
function render() {
    const accountStats = getAccountStats();

    const totalIncomes = incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const totalExpenses = expenses.filter(exp => exp.category !== 'Investissement').reduce((sum, exp) => sum + exp.amount, 0);
    const totalInvestments = expenses.filter(exp => exp.category === 'Investissement').reduce((sum, exp) => sum + exp.amount, 0);

    document.getElementById('overview').innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 p-5">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Revenus</p>
            <p class="text-2xl font-bold text-emerald-600">${totalIncomes.toFixed(2)} €</p>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 p-5">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Dépenses</p>
            <p class="text-2xl font-bold text-slate-900">${totalExpenses.toFixed(2)} €</p>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 p-5">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Investissements</p>
            <p class="text-2xl font-bold text-slate-900">${totalInvestments.toFixed(2)} €</p>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 p-5">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Solde net</p>
            <p class="text-2xl font-bold ${totalIncomes - totalExpenses - totalInvestments >= 0 ? 'text-emerald-600' : 'text-red-600'}">${(totalIncomes - totalExpenses - totalInvestments).toFixed(2)} €</p>
        </div>
    `;

    const filteredExpenses = expenses.filter(exp =>
        (!expenseFilters.category || exp.category === expenseFilters.category) &&
        (!expenseFilters.account || exp.account === expenseFilters.account) &&
        (!expenseFilters.beneficiary || exp.beneficiary === expenseFilters.beneficiary)
    );

    // #10 — escapeHtml sur toutes les données utilisateur
    document.getElementById('expenses-list').innerHTML = filteredExpenses.length > 0
        ? `<div class="border border-slate-200 rounded-lg overflow-hidden">
            <div class="grid grid-cols-[16px_1fr_140px_100px_100px_80px_auto] items-center px-4 py-2 bg-slate-50 border-b border-slate-200 gap-3">
                <span></span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nom</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Catégorie</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Compte</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pour</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Montant</span>
                <span></span>
            </div>
            ${filteredExpenses.map(exp => `
            <div class="grid grid-cols-[16px_1fr_140px_100px_100px_80px_auto] items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition group gap-3">
                <div class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${getColorForCategory(exp.category)}"></div>
                <span class="text-sm font-medium text-slate-800 truncate">${escapeHtml(exp.name)}</span>
                <span class="text-sm text-slate-500 truncate">${escapeHtml(exp.category)}</span>
                <span class="text-sm text-slate-500">${escapeHtml(exp.account)}</span>
                <span class="text-sm text-slate-500">${escapeHtml(exp.beneficiary)}</span>
                <span class="text-sm font-semibold text-slate-900 text-right">${exp.amount.toFixed(2)} €</span>
                <div class="flex items-center gap-2 justify-end">
                    <button onclick="toggleRecurring('${exp.id}', ${!!exp.recurring})"
                        title="${exp.recurring ? 'Retirer le statut automatique' : 'Marquer comme automatique'}"
                        class="text-xs px-2 py-0.5 rounded border transition ${exp.recurring
                            ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-red-50 hover:text-red-400 hover:border-red-200'
                            : 'text-slate-300 border-slate-200 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50'}">
                        ↻${exp.recurring ? ' auto' : ''}
                    </button>
                    <button onclick="editExpense('${exp.id}')" class="text-slate-300 hover:text-blue-500 transition opacity-0 group-hover:opacity-100 text-sm leading-none" title="Modifier">✎</button>
                    <button onclick="deleteExpense('${exp.id}')" class="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 text-base leading-none">×</button>
                </div>
            </div>
            `).join('')}
           </div>`
        : '<p class="text-slate-400 text-sm text-center py-10">Aucune dépense enregistrée</p>';

    document.getElementById('incomes-list').innerHTML = incomes.length > 0
        ? `<div class="border border-slate-200 rounded-lg overflow-hidden">
            <div class="grid grid-cols-[1fr_120px_80px_auto] items-center px-4 py-2 bg-slate-50 border-b border-slate-200 gap-3">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Source</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Personne</span>
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Montant</span>
                <span></span>
            </div>
            ${incomes.map(inc => `
            <div class="grid grid-cols-[1fr_120px_80px_auto] items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition group gap-3">
                <span class="text-sm font-medium text-slate-800">${escapeHtml(inc.name)}</span>
                <span class="text-sm text-slate-500">${escapeHtml(inc.person)}</span>
                <span class="text-sm font-semibold text-emerald-600 text-right">${inc.amount.toFixed(2)} €</span>
                <button onclick="deleteIncome('${inc.id}')" class="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 text-base leading-none">×</button>
            </div>
            `).join('')}
           </div>`
        : '<p class="text-slate-400 text-sm text-center py-10">Aucun revenu enregistré</p>';

    // #9 — Graphiques recalculés uniquement si l'onglet visible
    if (!document.getElementById('content-analysis').classList.contains('hidden')) {
        renderAnalysis(accountStats);
    }
    if (!document.getElementById('content-historique').classList.contains('hidden')) {
        renderHistorique();
    }
    if (!document.getElementById('content-epargne').classList.contains('hidden')) {
        renderEpargne();
    }
    if (!document.getElementById('content-menus').classList.contains('hidden')) {
        renderMenusTab();
    }
    renderSuivi();
}

function renderAnalysis(accountStats) {
    const trueSharedExpensesFromCommon = expenses
        .filter(exp => exp.account === 'Commun' && exp.beneficiary === 'Les deux' && exp.category !== 'Investissement')
        .reduce((sum, exp) => sum + exp.amount, 0);

    const totalSharedExpensesPaid = accountStats.Matthieu.sharedExpensesPaid + accountStats.Marie.sharedExpensesPaid;
    const totalToSplit = trueSharedExpensesFromCommon + totalSharedExpensesPaid;
    const halfShare = totalToSplit / 2;

    const matthieuTransfer = Math.max(0, halfShare + accountStats.Matthieu.individualExpensesFromCommon - accountStats.Matthieu.sharedExpensesPaid);
    const marieTransfer = Math.max(0, halfShare + accountStats.Marie.individualExpensesFromCommon - accountStats.Marie.sharedExpensesPaid);

    const categoryTotals = {};
    categories.forEach(cat => categoryTotals[cat] = 0);
    expenses.forEach(exp => {
        categoryTotals[exp.category] += exp.amount;
    });

    const totalIncomes = incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const remainingMoney = totalIncomes - totalExpenses;

    let chartData = Object.entries(categoryTotals).filter(([_, value]) => value > 0);
    if (remainingMoney > 0) chartData.push(['Reste disponible', remainingMoney]);
    const totalCategories = chartData.reduce((sum, [_, value]) => sum + value, 0);
    chartData.sort((a, b) => b[1] - a[1]);

    if (categoryChart) categoryChart.destroy();
    const ctxCat = document.getElementById('categoryChart').getContext('2d');
    categoryChart = new Chart(ctxCat, {
        type: 'pie',
        data: {
            labels: chartData.map(([name]) => name),
            datasets: [{
                data: chartData.map(([_, value]) => value),
                backgroundColor: chartData.map(([name]) => getColorForCategory(name))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            const percentage = ((value / totalCategories) * 100).toFixed(1);
                            return `${context.label} : ${value.toFixed(2)} € (${percentage} %)`;
                        }
                    }
                }
            }
        }
    });

    if (balanceChart) balanceChart.destroy();
    const ctxBal = document.getElementById('balanceChart').getContext('2d');
    balanceChart = new Chart(ctxBal, {
        type: 'bar',
        data: {
            labels: ['Matthieu', 'Marie', 'Commun'],
            datasets: [
                {
                    label: 'Revenus',
                    data: [accountStats.Matthieu.income, accountStats.Marie.income, accountStats.Commun.income + matthieuTransfer + marieTransfer],
                    backgroundColor: '#10b981'
                },
                {
                    label: 'Dépenses',
                    data: [accountStats.Matthieu.expenses, accountStats.Marie.expenses, accountStats.Commun.expenses],
                    backgroundColor: '#ef4444'
                },
                {
                    label: 'Investissements',
                    data: [accountStats.Matthieu.investments, accountStats.Marie.investments, accountStats.Commun.investments],
                    backgroundColor: '#34d399'
                },
                {
                    label: 'Virement commun',
                    data: [matthieuTransfer, marieTransfer, 0],
                    backgroundColor: '#f59e0b'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { x: { stacked: false }, y: { stacked: false } }
        }
    });

    const people = ['Matthieu', 'Marie', 'Commun'];
    document.getElementById('account-cards').innerHTML = people.map(person => {
        const transfer = person === 'Matthieu' ? matthieuTransfer : person === 'Marie' ? marieTransfer : 0;
        const finalBalance = person === 'Commun'
            ? 0
            : accountStats[person].income - accountStats[person].investments - accountStats[person].expenses - transfer;

        let details = '';
        if (person !== 'Commun' && accountStats[person].sharedExpensesPaid > 0) {
            details += `<div class="flex justify-between text-sm"><span class="text-slate-400 pl-2">↳ dont communes</span><span class="font-medium text-slate-500">${accountStats[person].sharedExpensesPaid.toFixed(2)} €</span></div>`;
        }
        if (person !== 'Commun' && accountStats[person].individualExpensesFromCommon > 0) {
            details += `<div class="flex justify-between text-sm"><span class="text-slate-500">Dépenses perso (commun)</span><span class="font-medium text-slate-700">${accountStats[person].individualExpensesFromCommon.toFixed(2)} €</span></div>`;
        }
        if (person !== 'Commun' && transfer > 0) {
            details += `<div class="flex justify-between text-sm"><span class="text-slate-500">Virement → Commun</span><span class="font-medium text-slate-700">${transfer.toFixed(2)} €</span></div>`;
        }
        if (person === 'Commun' && (matthieuTransfer > 0 || marieTransfer > 0)) {
            details += `<div class="flex justify-between text-sm"><span class="text-slate-500">Virements reçus</span><span class="font-medium text-emerald-600">+${(matthieuTransfer + marieTransfer).toFixed(2)} €</span></div>`;
        }

        return `
            <div class="bg-white rounded-xl border border-slate-200 p-5">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">${person}</p>
                <div class="space-y-2">
                    <div class="flex justify-between text-sm"><span class="text-slate-500">Revenus</span><span class="font-medium text-emerald-600">${accountStats[person].income.toFixed(2)} €</span></div>
                    ${accountStats[person].investments > 0 ? `<div class="flex justify-between text-sm"><span class="text-slate-500">Investissements</span><span class="font-medium text-slate-700">${accountStats[person].investments.toFixed(2)} €</span></div>` : ''}
                    <div class="flex justify-between text-sm"><span class="text-slate-500">Dépenses</span><span class="font-medium text-slate-700">${accountStats[person].expenses.toFixed(2)} €</span></div>
                    ${details}
                    <div class="border-t border-slate-100 pt-2 flex justify-between text-sm mt-1"><span class="font-semibold text-slate-700">Solde final</span><span class="font-bold ${finalBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}">${finalBalance.toFixed(2)} €</span></div>
                </div>
            </div>
        `;
    }).join('');
}

// Suivi (monthly tracking)
async function addTrackingEntry() {
    const name = document.getElementById('suivi-name').value.trim();
    const amount = parseFloat(document.getElementById('suivi-amount').value);
    const category = document.getElementById('suivi-category').value;
    const date = document.getElementById('suivi-date').value;

    if (!name || !amount || !category || !date) return;

    setButtonLoading('btn-add-tracking', true);
    const { error } = await supabaseClient.from('suivi').insert([{ name, amount, category, date }]);
    setButtonLoading('btn-add-tracking', false);

    if (error) {
        console.error('Erreur ajout suivi:', error);
        return;
    }

    await loadFromSupabase();
    document.getElementById('suivi-name').value = '';
    document.getElementById('suivi-amount').value = '';
    document.getElementById('suivi-category').value = '';
    // #4 — Réinitialiser à aujourd'hui après ajout
    document.getElementById('suivi-date').value = new Date().toISOString().split('T')[0];
}

async function deleteTrackingEntry(id) {
    if (!confirm('Supprimer cette transaction ?')) return;
    const { error } = await supabaseClient.from('suivi').delete().eq('id', id);
    if (error) {
        console.error('Erreur suppression suivi:', error);
        return;
    }
    await loadFromSupabase();
}

function changeSuiviMonth(delta) {
    selectedSuiviMonth = new Date(selectedSuiviMonth.getFullYear(), selectedSuiviMonth.getMonth() + delta, 1);
    renderSuivi();
}

function getCategoryBudgets() {
    const budgets = {};
    expenses.forEach(exp => {
        if (exp.category !== 'Investissement') {
            budgets[exp.category] = (budgets[exp.category] || 0) + exp.amount;
        }
    });
    return budgets;
}

function renderSuivi() {
    const year = selectedSuiviMonth.getFullYear();
    const month = selectedSuiviMonth.getMonth();

    const label = selectedSuiviMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('suivi-month-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);

    // #2 — Filtrage sans décalage de fuseau horaire : on parse la chaîne YYYY-MM-DD directement
    const monthEntries = trackingEntries.filter(entry => {
        const [y, m] = entry.date.split('-').map(Number);
        return y === year && m - 1 === month;
    });

    const spent = {};
    monthEntries.forEach(entry => {
        spent[entry.category] = (spent[entry.category] || 0) + entry.amount;
    });

    // Section dépenses automatiques
    const recurringExpenses = expenses.filter(exp => exp.recurring);
    const recurringSection = recurringExpenses.length > 0 ? `
        <div class="mb-5">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Dépenses automatiques</p>
            <div class="flex flex-wrap gap-2">
                ${recurringExpenses.map(exp => {
                    const alreadyAdded = monthEntries.some(e =>
                        e.name.toLowerCase() === exp.name.toLowerCase() && e.category === exp.category
                    );
                    return alreadyAdded
                        ? `<div class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
                               <span class="text-emerald-600 text-xs font-bold">✓</span>
                               <span class="text-slate-700 text-sm">${escapeHtml(exp.name)}</span>
                               <span class="text-slate-400 text-xs">${exp.amount.toFixed(0)} €</span>
                           </div>`
                        : `<button onclick="addRecurringById('${exp.id}')"
                               class="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg text-sm transition">
                               <span class="text-blue-500 text-xs font-bold">+</span>
                               <span class="text-slate-700 text-sm">${escapeHtml(exp.name)}</span>
                               <span class="text-slate-400 text-xs">${exp.amount.toFixed(0)} €</span>
                           </button>`;
                }).join('')}
            </div>
        </div>
    ` : '';

    document.getElementById('suivi-recurring').innerHTML = recurringSection;

    const budgets = getCategoryBudgets();
    const allCats = new Set([...Object.keys(budgets), ...Object.keys(spent)]);

    const cardsHtml = [...allCats].map(cat => {
        const budget = budgets[cat] || 0;
        const spentAmt = spent[cat] || 0;
        const remaining = budget - spentAmt;
        const pct = budget > 0 ? Math.min((spentAmt / budget) * 100, 100) : 100;
        const overBudget = spentAmt > budget && budget > 0;

        let barColor = '#10b981';
        if (pct >= 100) barColor = '#ef4444';
        else if (pct >= 80) barColor = '#f59e0b';

        return `
            <div class="bg-white rounded-xl border border-slate-200 p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${getColorForCategory(cat)}"></div>
                        <span class="text-sm font-medium text-slate-800">${escapeHtml(cat)}</span>
                    </div>
                    <span class="text-xs text-slate-400">${budget > 0 ? budget.toFixed(0) + ' € budget' : 'non défini'}</span>
                </div>
                <div class="progress-bar-track mb-2">
                    <div class="progress-bar-fill" style="width: ${pct}%; background-color: ${barColor}"></div>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="font-semibold text-slate-700">${spentAmt.toFixed(2)} € dépensés</span>
                    ${budget > 0
                        ? `<span class="${overBudget ? 'text-red-600 font-semibold' : 'text-slate-400'}">
                            ${overBudget ? '−' + Math.abs(remaining).toFixed(2) + ' € dépassé' : '+' + remaining.toFixed(2) + ' € restants'}
                           </span>`
                        : ''
                    }
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('suivi-budget-cards').innerHTML = allCats.size > 0
        ? cardsHtml
        : '<p class="text-slate-400 text-sm col-span-3 text-center py-6">Aucune donnée pour ce mois</p>';

    // #2 — Tri et affichage des dates sans décalage timezone
    const sorted = [...monthEntries].sort((a, b) => b.date.localeCompare(a.date));
    document.getElementById('suivi-list').innerHTML = sorted.length > 0
        ? `<div class="border border-slate-200 rounded-lg overflow-hidden">
            ${sorted.map(entry => {
                const [y, m, d] = entry.date.split('-').map(Number);
                const dateStr = new Date(y, m - 1, d).toLocaleDateString('fr-FR');
                return `
                <div class="grid grid-cols-[16px_1fr_140px_80px_80px_auto] items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition group gap-3">
                    <div class="w-2 h-2 rounded-full" style="background-color: ${getColorForCategory(entry.category)}"></div>
                    <span class="text-sm font-medium text-slate-800 truncate">${escapeHtml(entry.name)}</span>
                    <span class="text-sm text-slate-500 truncate">${escapeHtml(entry.category)}</span>
                    <span class="text-xs text-slate-400">${dateStr}</span>
                    <span class="text-sm font-semibold text-slate-900 text-right">${entry.amount.toFixed(2)} €</span>
                    <button onclick="deleteTrackingEntry('${entry.id}')" class="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 text-base leading-none text-right">×</button>
                </div>`;
            }).join('')}
           </div>`
        : '<p class="text-slate-400 text-sm text-center py-8">Aucune transaction pour ce mois</p>';
}

async function toggleRecurring(id, current) {
    const { error } = await supabaseClient
        .from('expenses')
        .update({ recurring: !current })
        .eq('id', id);
    if (error) { console.error('Erreur toggle automatique:', error); return; }
    await loadFromSupabase();
}

async function addRecurringById(id) {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;
    const now = new Date();
    const isCurrentMonth = selectedSuiviMonth.getFullYear() === now.getFullYear()
                        && selectedSuiviMonth.getMonth() === now.getMonth();
    const date = isCurrentMonth
        ? now.toISOString().split('T')[0]
        : `${selectedSuiviMonth.getFullYear()}-${String(selectedSuiviMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const { error } = await supabaseClient.from('suivi').insert([{ name: exp.name, amount: exp.amount, category: exp.category, date }]);
    if (error) { console.error('Erreur ajout automatique:', error); return; }
    await loadFromSupabase();
}

// Historique annuel
function changeHistYear(delta) {
    selectedHistYear += delta;
    renderHistorique();
}

function renderHistorique() {
    const year = selectedHistYear;
    document.getElementById('hist-year-label').textContent = year;

    const monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    // Filtrer les entrées du Suivi pour l'année
    const yearEntries = trackingEntries.filter(e => e.date.startsWith(String(year)));

    // Grouper par mois et catégorie
    const monthlyByCategory = Array.from({ length: 12 }, () => ({}));
    yearEntries.forEach(entry => {
        const m = parseInt(entry.date.split('-')[1]) - 1;
        monthlyByCategory[m][entry.category] = (monthlyByCategory[m][entry.category] || 0) + entry.amount;
    });

    // Catégories présentes dans l'année, dans l'ordre de categories[]
    const usedCats = categories.filter(cat => yearEntries.some(e => e.category === cat));

    // Budget mensuel de référence (depuis onglet Dépenses)
    const totalBudget = expenses
        .filter(e => e.category !== 'Investissement')
        .reduce((s, e) => s + e.amount, 0);

    // Datasets : une barre par catégorie + une ligne de budget
    const datasets = usedCats.map(cat => ({
        label: cat,
        type: 'bar',
        data: monthlyByCategory.map(m => m[cat] || 0),
        backgroundColor: getColorForCategory(cat),
        stack: 'spending',
    }));

    if (totalBudget > 0) {
        datasets.push({
            label: 'Budget mensuel',
            type: 'line',
            data: Array(12).fill(totalBudget),
            borderColor: '#6b7280',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
        });
    }

    if (histChart) histChart.destroy();
    const ctx = document.getElementById('histChart').getContext('2d');
    histChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: monthLabels, datasets },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true }
            }
        }
    });

    // Tableau récapitulatif
    if (usedCats.length === 0) {
        document.getElementById('hist-table').innerHTML =
            '<p class="text-slate-400 text-center py-8">Aucune donnée pour cette année dans le Suivi</p>';
        return;
    }

    const rows = monthLabels.map((label, i) => {
        const total = Object.values(monthlyByCategory[i]).reduce((s, v) => s + v, 0);
        if (total === 0) return '';
        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="py-2 pr-4 text-slate-700 font-medium">${label}</td>
                ${usedCats.map(cat => `
                    <td class="text-right py-2 px-2 text-slate-500">
                        ${monthlyByCategory[i][cat] ? monthlyByCategory[i][cat].toFixed(0) + ' €' : '-'}
                    </td>
                `).join('')}
                <td class="text-right py-2 pl-4 font-semibold ${totalBudget > 0 && total > totalBudget ? 'text-rose-600' : 'text-slate-800'}">
                    ${total.toFixed(0)} €
                </td>
            </tr>`;
    }).join('');

    document.getElementById('hist-table').innerHTML = `
        <table class="w-full text-sm border-collapse">
            <thead>
                <tr class="border-b-2 border-slate-200">
                    <th class="text-left py-2 pr-4 text-slate-500 font-semibold">Mois</th>
                    ${usedCats.map(cat => `<th class="text-right py-2 px-2 text-slate-500 font-semibold">${escapeHtml(cat)}</th>`).join('')}
                    <th class="text-right py-2 pl-4 text-slate-700 font-semibold">Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

// ── Épargne ──────────────────────────────────────────────────────────────────

function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function changeEpargneMonth(delta) {
    selectedEpargneMonth = new Date(
        selectedEpargneMonth.getFullYear(),
        selectedEpargneMonth.getMonth() + delta,
        1
    );
    renderEpargne();
}

async function saveEpargneSnapshot() {
    const monthStr = monthKey(selectedEpargneMonth);
    const rows = [];
    savingsTypes.forEach(type => {
        const input = document.getElementById(`epargne-input-${type.replace(/\s+/g, '-')}`);
        if (!input) return;
        const val = parseFloat(input.value);
        if (!isNaN(val) && val >= 0) rows.push({ type, amount: val, month: monthStr });
    });
    if (rows.length === 0) return;
    setButtonLoading('btn-save-epargne', true);
    const { error } = await supabaseClient.from('epargne_snapshots')
        .upsert(rows, { onConflict: 'type,month' });
    setButtonLoading('btn-save-epargne', false);
    if (error) { console.error('Erreur snapshot épargne:', error); return; }
    await loadFromSupabase();
}

function saveSavingsGoal() {
    const val = parseFloat(document.getElementById('savings-goal-input').value);
    if (!val || val <= 0) return;
    savingsGoal = val;
    localStorage.setItem('savings-goal', val);
    document.getElementById('savings-current-goal').textContent = `Objectif actuel : ${val.toFixed(0)} €`;
    renderEpargne();
}

function renderEpargne() {
    // ── Label mois ──
    const label = selectedEpargneMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('epargne-month-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);

    const currentKey = monthKey(selectedEpargneMonth);
    const prevMonth = new Date(selectedEpargneMonth.getFullYear(), selectedEpargneMonth.getMonth() - 1, 1);
    const prevKey = monthKey(prevMonth);

    // ── Grille d'inputs ──
    document.getElementById('epargne-inputs').innerHTML = savingsTypes.map(type => {
        const inputId = `epargne-input-${type.replace(/\s+/g, '-')}`;
        const snap = savingsSnapshots.find(s => s.type === type && s.month === currentKey);
        const prevSnap = savingsSnapshots.find(s => s.type === type && s.month === prevKey);
        const currentVal = snap ? snap.amount : '';
        let deltaHtml = '';
        if (snap && prevSnap) {
            const delta = snap.amount - prevSnap.amount;
            const sign = delta >= 0 ? '+' : '';
            const color = delta >= 0 ? 'text-emerald-600' : 'text-red-500';
            deltaHtml = `<span class="text-xs font-semibold ${color}">${sign}${delta.toFixed(0)} €</span>`;
        } else {
            deltaHtml = `<span class="text-xs text-slate-300">—</span>`;
        }
        const dotColor = savingsColors[type] || '#94a3b8';
        return `
            <div class="grid grid-cols-[16px_1fr_180px_100px] items-center px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition gap-3">
                <div class="w-2 h-2 rounded-full flex-shrink-0" style="background-color:${dotColor}"></div>
                <span class="text-sm font-medium text-slate-800">${escapeHtml(type)}</span>
                <input type="number" id="${inputId}" value="${currentVal}" placeholder="0" step="0.01" min="0"
                       class="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-right w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <div class="text-right">${deltaHtml}</div>
            </div>`;
    }).join('');

    // ── Carte total / objectif ──
    const currentSnaps = savingsSnapshots.filter(s => s.month === currentKey);
    const monthTotal = currentSnaps.reduce((sum, s) => sum + s.amount, 0);
    const goalEl = document.getElementById('epargne-goal');
    if (savingsGoal > 0) {
        const pct = Math.min((monthTotal / savingsGoal) * 100, 100);
        const barColor = pct >= 100 ? '#10b981' : pct >= 75 ? '#3b82f6' : '#6366f1';
        goalEl.innerHTML = `
            <div class="bg-white rounded-xl border border-slate-200 p-5">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total actuel</p>
                        <p class="text-2xl font-bold text-slate-900">${monthTotal.toFixed(0)} €
                            <span class="text-sm font-normal text-slate-400">/ ${savingsGoal.toFixed(0)} €</span>
                        </p>
                    </div>
                    <p class="text-3xl font-bold" style="color:${barColor}">${pct.toFixed(0)} %</p>
                </div>
                <div class="progress-bar-track">
                    <div class="progress-bar-fill" style="width:${pct}%; background-color:${barColor}"></div>
                </div>
                <p class="mt-2 text-xs text-slate-400 text-right">Reste : ${Math.max(0, savingsGoal - monthTotal).toFixed(0)} €</p>
            </div>`;
    } else {
        goalEl.innerHTML = currentSnaps.length > 0
            ? `<div class="bg-slate-50 rounded-lg border border-dashed border-slate-200 p-4 flex justify-between items-center">
                <p class="text-sm text-slate-500">Total épargné ce mois : <span class="font-semibold text-slate-800">${monthTotal.toFixed(2)} €</span></p>
                <p class="text-xs text-slate-400">${currentSnaps.length} / ${savingsTypes.length} comptes renseignés</p>
               </div>`
            : '';
    }

    // ── Graphique évolution ──
    const allMonthKeys = [...new Set(savingsSnapshots.map(s => s.month))].sort();
    if (savingsEvolutionChart) { savingsEvolutionChart.destroy(); savingsEvolutionChart = null; }
    if (allMonthKeys.length === 0) return;

    const chartLabels = allMonthKeys.map(mk => {
        const [y, m] = mk.split('-').map(Number);
        const lbl = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
        return lbl.charAt(0).toUpperCase() + lbl.slice(1);
    });

    const typeDatasets = savingsTypes.map(type => ({
        label: type,
        data: allMonthKeys.map(mk => {
            const s = savingsSnapshots.find(x => x.type === type && x.month === mk);
            return s ? s.amount : null;
        }),
        borderColor: savingsColors[type] || '#94a3b8',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        spanGaps: false,
    }));

    const totalDataset = {
        label: 'Total',
        data: allMonthKeys.map(mk => {
            const snaps = savingsSnapshots.filter(x => x.month === mk);
            return snaps.length > 0 ? snaps.reduce((s, x) => s + x.amount, 0) : null;
        }),
        borderColor: '#1e293b',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        tension: 0.3,
        pointRadius: 4,
        spanGaps: false,
    };

    const ctx = document.getElementById('savingsEvolutionChart').getContext('2d');
    savingsEvolutionChart = new Chart(ctx, {
        type: 'line',
        data: { labels: chartLabels, datasets: [...typeDatasets, totalDataset] },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: c => `${c.dataset.label} : ${c.raw !== null ? c.raw.toFixed(0) + ' €' : 'n/a'}` } }
            },
            scales: { y: { beginAtZero: false } }
        }
    });
}

// ── Menus & Courses ──────────────────────────────────────────────────────────

function changeMenuWeek(delta) {
    selectedMenuWeek = new Date(
        selectedMenuWeek.getFullYear(),
        selectedMenuWeek.getMonth(),
        selectedMenuWeek.getDate() + delta * 7
    );
    renderMenusTab();
}

function renderShoppingList() {
    const wk = weekKey(selectedMenuWeek);
    const weekPlans = mealPlan.filter(p => p.week_start === wk && p.menu_id);
    const menuIds = [...new Set(weekPlans.map(p => p.menu_id))];
    const ingredientMap = {};
    menuIds.forEach(id => {
        const menu = menus.find(m => m.id === id);
        if (!menu) return;
        menu.ingredients.forEach(ing => {
            if (!ingredientMap[ing.name]) ingredientMap[ing.name] = [];
            if (!ingredientMap[ing.name].includes(menu.name))
                ingredientMap[ing.name].push(menu.name);
        });
    });
    const items = Object.entries(ingredientMap).sort(([a], [b]) => a.localeCompare(b, 'fr'));
    const el = document.getElementById('menus-shopping-list');
    if (items.length === 0) {
        el.innerHTML = '<p class="text-slate-400 text-sm text-center py-6">Aucun menu planifié cette semaine</p>';
        return;
    }
    el.innerHTML = `<div class="border border-slate-200 rounded-xl overflow-hidden">
        ${items.map(([name, sources]) => `
            <label class="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition">
                <input type="checkbox" class="w-4 h-4 accent-blue-600 flex-shrink-0">
                <span class="text-sm text-slate-800 flex-1">${escapeHtml(name)}</span>
                <span class="text-xs text-slate-400">${sources.map(s => escapeHtml(s)).join(', ')}</span>
            </label>`).join('')}
    </div>`;
}

function renderMenusTab() {
    const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const mon = getMonday(selectedMenuWeek);
    const wk = weekKey(selectedMenuWeek);

    // Label semaine
    const label = mon.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('menus-week-label').textContent = `Semaine du ${label}`;

    // Grille planning
    const headerCells = days.map(d =>
        `<th class="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">${d}</th>`
    ).join('');

    const makeRow = (mealType, label) => {
        const cells = [0,1,2,3,4,5,6].map(day => {
            const plan = mealPlan.find(p => p.week_start === wk && p.day_of_week === day && p.meal_type === mealType);
            const val = plan?.menu_id || '';
            return `<td class="px-2 py-2">
                <select id="meal-sel-${day}-${mealType}"
                        onchange="saveSingleMeal(${day}, '${mealType}', this.value)"
                        class="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white">
                    <option value="">—</option>
                    ${menus.map(m => `<option value="${m.id}"${m.id === val ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
                </select>
            </td>`;
        }).join('');
        return `<tr>
            <td class="px-3 py-2 text-xs font-semibold text-slate-500 whitespace-nowrap">${label}</td>
            ${cells}
        </tr>`;
    };

    document.getElementById('menus-planning-grid').innerHTML = `
        <table class="w-full min-w-[820px] border border-slate-200 rounded-xl overflow-hidden text-sm">
            <thead class="bg-slate-50 border-b border-slate-200">
                <tr>
                    <th class="px-3 py-2 w-16"></th>
                    ${headerCells}
                </tr>
            </thead>
            <tbody>
                ${makeRow('midi', 'Midi')}
                ${makeRow('soir', 'Soir')}
            </tbody>
        </table>`;

    // Liste de courses
    renderShoppingList();

    // Catalogue des menus
    document.getElementById('menus-list').innerHTML = menus.length === 0
        ? '<p class="text-slate-400 text-sm text-center py-6">Aucun menu créé</p>'
        : menus.map(menu => `
            <div class="group border border-slate-200 rounded-xl p-4 mb-3">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-semibold text-slate-800">${escapeHtml(menu.name)}</span>
                    <button onclick="deleteMenu('${menu.id}')"
                            class="text-slate-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 text-base leading-none">×</button>
                </div>
                <div class="flex flex-wrap gap-2 mb-3">
                    ${menu.ingredients.length === 0
                        ? '<span class="text-xs text-slate-400">Aucun ingrédient</span>'
                        : menu.ingredients.map(ing => `
                            <span class="group/ing inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                                ${escapeHtml(ing.name)}
                                <button onclick="deleteIngredient('${ing.id}')"
                                        class="text-slate-300 hover:text-red-500 transition opacity-0 group-hover/ing:opacity-100 leading-none">&times;</button>
                            </span>`).join('')}
                </div>
                <div class="flex gap-2">
                    <input type="text" id="add-ing-input-${menu.id}" placeholder="Ajouter un ingrédient"
                           class="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    <button id="btn-add-ing-${menu.id}" onclick="addIngredient('${menu.id}')"
                            class="border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg px-3 py-1.5 text-xs font-medium transition">+</button>
                </div>
            </div>`).join('');

    // Enter key pour chaque input ingrédient
    menus.forEach(menu => {
        document.getElementById(`add-ing-input-${menu.id}`)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') addIngredient(menu.id);
        });
    });
}

async function saveSingleMeal(day, mealType, menuId) {
    const wk = weekKey(selectedMenuWeek);
    const row = { week_start: wk, day_of_week: day, meal_type: mealType, menu_id: menuId || null };
    const { error } = await supabaseClient.from('meal_plan')
        .upsert([row], { onConflict: 'week_start,day_of_week,meal_type' });
    if (error) { console.error('Erreur sauvegarde planning:', error); return; }
    // Mise à jour locale sans rechargement complet
    mealPlan = mealPlan.filter(p => !(p.week_start === wk && p.day_of_week === day && p.meal_type === mealType));
    if (menuId) mealPlan.push(row);
    renderShoppingList();
}

async function addMenu() {
    const name = document.getElementById('new-menu-name').value.trim();
    if (!name) return;
    setButtonLoading('btn-add-menu', true);
    const { error } = await supabaseClient.from('menus').insert([{ name }]);
    setButtonLoading('btn-add-menu', false);
    if (error) { console.error('Erreur ajout menu:', error); return; }
    document.getElementById('new-menu-name').value = '';
    await loadFromSupabase();
}

async function deleteMenu(id) {
    if (!confirm('Supprimer ce menu et tous ses ingrédients ?')) return;
    const { error } = await supabaseClient.from('menus').delete().eq('id', id);
    if (error) { console.error('Erreur suppression menu:', error); return; }
    await loadFromSupabase();
}

async function addIngredient(menuId) {
    const input = document.getElementById(`add-ing-input-${menuId}`);
    const name = input?.value.trim();
    if (!name) return;
    setButtonLoading(`btn-add-ing-${menuId}`, true);
    const { error } = await supabaseClient.from('menu_ingredients').insert([{ menu_id: menuId, name }]);
    setButtonLoading(`btn-add-ing-${menuId}`, false);
    if (error) { console.error('Erreur ajout ingrédient:', error); return; }
    if (input) input.value = '';
    await loadFromSupabase();
}

async function deleteIngredient(id) {
    const { error } = await supabaseClient.from('menu_ingredients').delete().eq('id', id);
    if (error) { console.error('Erreur suppression ingrédient:', error); return; }
    await loadFromSupabase();
}

// Tab switching — #9 : renderAnalysis/renderHistorique appelés uniquement en basculant sur leur onglet
function switchTab(tab) {
    ['expenses', 'incomes', 'analysis', 'suivi', 'historique', 'epargne', 'menus'].forEach(t => {
        document.getElementById(`tab-${t}`).className = `px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${t === tab ? 'text-blue-600 border-blue-600' : 'text-slate-500 hover:text-slate-700 border-transparent'}`;
        document.getElementById(`content-${t}`).className = t === tab ? '' : 'hidden';
    });
    if (tab === 'analysis') renderAnalysis(getAccountStats());
    if (tab === 'historique') renderHistorique();
    if (tab === 'epargne') renderEpargne();
    if (tab === 'menus') renderMenusTab();
}

// #4 — Date par défaut + #6 — Touche Entrée pour valider les formulaires
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('suivi-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('hist-year-label').textContent = selectedHistYear;
    if (savingsGoal > 0) {
        document.getElementById('savings-goal-input').value = savingsGoal;
        document.getElementById('savings-current-goal').textContent = `Objectif actuel : ${savingsGoal.toFixed(0)} €`;
    }

    ['expense-name', 'expense-amount', 'expense-category', 'expense-account', 'expense-beneficiary'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addExpense(); });
    });

    ['income-name', 'income-amount', 'income-person'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addIncome(); });
    });

    ['suivi-name', 'suivi-amount', 'suivi-category', 'suivi-date'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addTrackingEntry(); });
    });

    document.getElementById('new-menu-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') addMenu(); });

});
