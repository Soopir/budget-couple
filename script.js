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
        { data: supaTracking, error: trackError }
    ] = await Promise.all([
        supabaseClient.from('expenses').select('*'),
        supabaseClient.from('incomes').select('*'),
        supabaseClient.from('suivi').select('*'),
    ]);

    if (expError || incError || trackError) {
        console.error('Erreur Supabase:', expError || incError || trackError);
        return;
    }

    expenses = supaExpenses || [];
    incomes = supaIncomes || [];
    trackingEntries = supaTracking || [];

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

    // #7 — Désactivation du bouton pendant le chargement
    setButtonLoading('btn-add-expense', true);
    // #3 — variable data supprimée
    const { error } = await supabaseClient
        .from('expenses')
        .insert([{ name, amount, category, account, beneficiary, recurring }]);
    setButtonLoading('btn-add-expense', false);

    if (error) {
        console.error('Erreur ajout dépense:', error);
        return;
    }

    await loadFromSupabase();
    document.getElementById('expense-name').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-category').value = '';
    document.getElementById('expense-account').value = '';
    document.getElementById('expense-beneficiary').value = '';
    document.getElementById('expense-recurring').checked = false;
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

// Tab switching — #9 : renderAnalysis/renderHistorique appelés uniquement en basculant sur leur onglet
function switchTab(tab) {
    ['expenses', 'incomes', 'analysis', 'suivi', 'historique'].forEach(t => {
        document.getElementById(`tab-${t}`).className = `px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${t === tab ? 'text-blue-600 border-blue-600' : 'text-slate-500 hover:text-slate-700 border-transparent'}`;
        document.getElementById(`content-${t}`).className = t === tab ? '' : 'hidden';
    });
    if (tab === 'analysis') renderAnalysis(getAccountStats());
    if (tab === 'historique') renderHistorique();
}

// #4 — Date par défaut + #6 — Touche Entrée pour valider les formulaires
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('suivi-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('hist-year-label').textContent = selectedHistYear;

    ['expense-name', 'expense-amount', 'expense-category', 'expense-account', 'expense-beneficiary'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addExpense(); });
    });

    ['income-name', 'income-amount', 'income-person'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addIncome(); });
    });

    ['suivi-name', 'suivi-amount', 'suivi-category', 'suivi-date'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') addTrackingEntry(); });
    });
});
