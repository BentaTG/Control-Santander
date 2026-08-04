/* ==========================================================================
   SANTANDER WORLDMEMBER — CORE APPLICATION ENGINE (app.js)
   Lógica inteligente con cobro y DESHACER cuota por cuota para préstamos,
   paleta de 12 categorías, comentarios sutiles y ergonomía 2x2 amplia.
   ========================================================================== */

// --- ESTADO Y ALMACENAMIENTO (LOCALSTORAGE / MEMORY) ---
const STORAGE_KEY = 'santander_app_data_v2';
const FRIENDS_STORAGE_KEY = 'santander_friends_list';
const DEFAULT_CURRENCY = 'CLP';
const DEFAULT_CARD_NAME = 'SANTANDER WORLDMEMBER';
const DEFAULT_HOLDER_NAME = 'BENJAMÍN TRALMA GUTIÉRREZ';

let appData = {
    settings: {
        cardName: DEFAULT_CARD_NAME,
        last4: '4532',
        holderName: DEFAULT_HOLDER_NAME,
        creditLimit: 1000000,
        initialBalance: 0,
        closingDay: 25,
        dueDay: 5,
        currency: DEFAULT_CURRENCY
    },
    transactions: []
};

let savedFriends = [];
let chartInstances = {};
let activeLoanFilter = 'ALL';

// --- INICIALIZACIÓN ---


// ==========================================================================
// FILTROS CUSTOM (CHIPS)
// ==========================================================================
function initCustomSelect(selectId, labelPrefix) {
    const selectElem = document.getElementById(selectId);
    if (!selectElem) return;

    selectElem.classList.add('hidden-select');
    
    let wrapper = selectElem.parentElement;
    if (!wrapper.classList.contains('custom-select-wrapper')) {
        wrapper.classList.add('custom-select-wrapper');
    }

    let chip = wrapper.querySelector('.chip-filter');
    if (!chip) {
        chip = document.createElement('div');
        chip.className = 'chip-filter';
        wrapper.appendChild(chip);
    }

    let menu = wrapper.querySelector('.custom-dropdown-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'custom-dropdown-menu';
        wrapper.appendChild(menu);
    }

    function syncCustomUI() {
        const options = Array.from(selectElem.options);
        const selectedOpt = options.find(o => o.selected) || options[0];
        if (!selectedOpt) return;
        const isDefault = selectedOpt.value === 'ALL';

        let chipHtml = `<span>${labelPrefix}: ${selectedOpt.text}</span>`;
        if (isDefault) {
            chipHtml += ` <i data-lucide="chevron-down" style="width:14px;height:14px;margin-left:4px"></i>`;
            chip.classList.remove('active');
        } else {
            chipHtml += ` <i data-lucide="x" style="width:14px;height:14px;margin-left:4px" class="clear-icon"></i>`;
            chip.classList.add('active');
        }
        chip.innerHTML = chipHtml;
        if (window.lucide) lucide.createIcons({root: chip});

        menu.innerHTML = options.map(opt => `
            <div class="dropdown-option ${opt.selected ? 'selected' : ''}" data-value="${opt.value}">
                <span>${opt.text}</span>
                ${opt.selected ? '<span style="font-weight:bold; font-size:14px;">✓</span>' : ''}
            </div>
        `).join('');

        menu.querySelectorAll('.dropdown-option').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectElem.value = item.dataset.value;
                selectElem.dispatchEvent(new Event('change'));
                menu.classList.remove('show');
                syncCustomUI();
            });
        });
    }

    chip.onclick = (e) => {
        e.stopPropagation();
        const isClearIcon = e.target.closest('.clear-icon');
        
        if (isClearIcon && chip.classList.contains('active')) {
            selectElem.value = 'ALL';
            selectElem.dispatchEvent(new Event('change'));
            menu.classList.remove('show');
            syncCustomUI();
        } else {
            document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            menu.classList.toggle('show');
        }
    };

    syncCustomUI();
    selectElem.syncCustomUI = syncCustomUI;
}

document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown-menu.show').forEach(m => m.classList.remove('show'));
});

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        initCustomSelect('filterCycle', 'Ciclo');
        initCustomSelect('filterType', 'Tipo');
        initCustomSelect('filterResponsible', 'Responsable');
        

    }, 200);
});
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    loadFriendsList();
    initUI();
    initEventListeners();
    initSidebarToggle();
    renderAll();
    lucide.createIcons();
});

// --- SIDEBAR COLAPSABLE FLOTANTE ---
function initSidebarToggle() {
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('btnToggleSidebar');
    const toggleIcon = document.getElementById('toggleSidebarIcon');
    const mainContent = document.querySelector('.main-content');
    
    if (!sidebar || !toggleBtn) return;

    const isCollapsed = localStorage.getItem('santander_sidebar_collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('expanded-canvas');
    }

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const collapsedNow = sidebar.classList.contains('collapsed');
        if (mainContent) mainContent.classList.toggle('expanded-canvas', collapsedNow);
        localStorage.setItem('santander_sidebar_collapsed', collapsedNow ? 'true' : 'false');
        
        // La rotación del ícono ahora se maneja puramente por CSS para evitar el re-renderizado del DOM y el parpadeo de los demás íconos.
        setTimeout(() => {
            Object.values(chartInstances).forEach(chart => {
                if (chart && typeof chart.resize === 'function') chart.resize();
            });
        }, 220);
    });
}

function getFriendShare(tx) {
    if (tx.customFriendAmount !== undefined && tx.customFriendAmount !== null && tx.customFriendAmount !== '') {
        const val = parseFloat(tx.customFriendAmount);
        if (!isNaN(val)) return val;
    }
    return (tx.responsible === 'Compartido') ? tx.amount / 2 : tx.amount;
}

// --- PERSISTENCIA DE DATOS ---
function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('tarjeta_clara_data_v2');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appData = { ...appData, ...parsed, settings: { ...appData.settings, ...parsed.settings } };
            if (!appData.settings.cardName || appData.settings.cardName === 'TARJETA CLARA' || appData.settings.cardName === 'Tarjeta Clara' || appData.settings.cardName === 'SANTANDER') {
                appData.settings.cardName = DEFAULT_CARD_NAME;
            }

            // Normalización inteligente para préstamos en cuotas (Ej: Lentes del Papá por $127.900 en 6 cuotas)
            appData.transactions.forEach(tx => {
                // Forzar fecha de Lentes permanentemente si estuviera errónea (por ser un fix de bd)
                if (tx.description && tx.description.toLowerCase().includes('lente') && tx.amount === 127900) {
                    tx.date = '2026-06-24';
                }

                if (tx.type === 'EXPENSE' && (tx.responsible === 'Otros' || tx.responsible === 'Compartido') && (tx.installments || 1) > 1) {
                    // Solo migrar/inicializar cuotas pagadas si aún no existe el campo
                    if (tx.friendPaidInstallments === undefined) {
                        if (tx.description && tx.description.toLowerCase().includes('lente') && tx.amount === 127900) {
                            tx.friendPaidInstallments = 2; // Estado base para migración
                            tx.status = 'PARTIAL';
                            tx.partialPaidAmount = Math.round((127900 / 6) * 2);
                        } else if (tx.status === 'PAID') {
                            tx.friendPaidInstallments = tx.installments;
                        } else if (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) {
                            const instVal = tx.amount / tx.installments;
                            tx.friendPaidInstallments = Math.min(tx.installments - 1, Math.max(1, Math.round(tx.partialPaidAmount / instVal)));
                        } else {
                            tx.friendPaidInstallments = 0;
                        }
                    }
                }
            });

        } catch (e) {
            console.error("Error al cargar datos:", e);
        }
    }
    populateCycleSelects();
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    renderAll();
    if (typeof window.syncToSupabase === 'function') {
        window.syncToSupabase();
    }
}

function loadFriendsList() {
    const saved = localStorage.getItem(FRIENDS_STORAGE_KEY);
    if (saved) {
        try { savedFriends = JSON.parse(saved); } catch (e) { savedFriends = []; }
    }
    if (savedFriends.length === 0) {
        const friendsFromTx = new Set();
        appData.transactions.forEach(tx => {
            if (tx.friendName && tx.friendName.trim() !== '') {
                friendsFromTx.add(tx.friendName.trim());
            }
        });
        savedFriends = Array.from(friendsFromTx);
        saveFriendsList();
    }
    updateFriendsDatalist();
}

function saveFriendsList() {
    localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(savedFriends));
    updateFriendsDatalist();
    if (typeof window.syncToSupabase === 'function') {
        window.syncToSupabase();
    }
}

function addFriendToMemory(name) {
    if (!name) return;
    const cleanName = name.trim();
    if (cleanName === '' || cleanName.toLowerCase() === 'yo') return;
    if (!savedFriends.some(f => f.toLowerCase() === cleanName.toLowerCase())) {
        savedFriends.push(cleanName);
        saveFriendsList();
    }
}

function updateFriendsDatalist() {
    const datalist = document.getElementById('friendsList');
    if (!datalist) return;
    datalist.innerHTML = savedFriends.map(f => `<option value="${f}">`).join('');
}

// --- INTERFAZ E IDIOMA DE SIMBOLOS ---
function initUI() {
    const curr = appData.settings.currency || DEFAULT_CURRENCY;
    const sym = getCurrencySymbol(curr);
    const prefix = document.getElementById('currencySymbolPrefix');
    if (prefix) prefix.innerText = sym;
}

function getCurrencySymbol(currencyCode) {
    const map = { 'CLP': '$', 'USD': '$', 'MXN': '$', 'COP': '$', 'PEN': 'S/', 'EUR': '€', 'ARS': '$' };
    return map[currencyCode] || '$';
}

function formatMoney(amount) {
    const curr = appData.settings.currency || DEFAULT_CURRENCY;
    const sym = getCurrencySymbol(curr);
    const val = Math.round(Number(amount) || 0);
    return `${sym} ${val.toLocaleString('es-CL')}`;
}

// --- FECHAS Y CICLOS ---
function populateCycleSelects() {
    const closingSelect = document.getElementById('setClosingDay');
    const dueSelect = document.getElementById('setDueDay');
    if (!closingSelect || !dueSelect) return;
    
    closingSelect.innerHTML = ''; dueSelect.innerHTML = '';
    for (let i = 1; i <= 31; i++) {
        closingSelect.innerHTML += `<option value="${i}">Día ${i}</option>`;
        dueSelect.innerHTML += `<option value="${i}">Día ${i}</option>`;
    }
    closingSelect.value = appData.settings.closingDay;
    dueSelect.value = appData.settings.dueDay;
}

function getCycleDates(referenceDate = new Date()) {
    const closingDay = appData.settings.closingDay;
    const dueDay = appData.settings.dueDay;
    
    let year = referenceDate.getFullYear();
    let month = referenceDate.getMonth();
    let day = referenceDate.getDate();

    let cycleStart, cycleEnd;

    if (day > closingDay) {
        cycleStart = new Date(year, month, closingDay + 1, 0, 0, 0);
        cycleEnd = new Date(year, month + 1, closingDay, 23, 59, 59);
    } else {
        cycleStart = new Date(year, month - 1, closingDay + 1, 0, 0, 0);
        cycleEnd = new Date(year, month, closingDay, 23, 59, 59);
    }

    let dueDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, dueDay, 23, 59, 59);
    if (dueDay <= closingDay) {
        dueDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth() + 1, dueDay, 23, 59, 59);
    } else {
        dueDate = new Date(cycleEnd.getFullYear(), cycleEnd.getMonth(), dueDay, 23, 59, 59);
    }

    return { cycleStart, cycleEnd, dueDate };
}

function getCycleLabel(date) {
    const { cycleStart, cycleEnd } = getCycleDates(new Date(date));
    const startStr = cycleStart.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    const endStr = cycleEnd.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    return `${startStr} - ${endStr}`;
}

// --- EVENT LISTENERS ---
function initEventListeners() {
    // Nav
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
            
            const targetBtn = e.currentTarget;
            targetBtn.classList.add('active');
            const viewId = targetBtn.getAttribute('data-view');
            const targetView = document.getElementById(viewId);
            if (targetView) targetView.classList.add('active');
            
            localStorage.setItem('active_view', viewId);
            
            if (viewId === 'view-analytics') {
                setTimeout(renderCharts, 50);
            }
        });
    });

    const savedView = localStorage.getItem('active_view');
    if (savedView) {
        const btnToClick = document.querySelector(`.nav-item[data-view="${savedView}"]`);
        if (btnToClick) {
            btnToClick.click();
        }
    }

    // Modals
    const modalTx = document.getElementById('modalTransaction');
    const modalSet = document.getElementById('modalSettings');
    const modalExp = document.getElementById('modalExport');
    const modalMobileTools = document.getElementById('modalMobileTools');

    const openTxModal = (type = 'EXPENSE') => {
        resetTxForm();
        setTxModalType(type);
        modalTx.classList.add('open');
    };

    document.getElementById('btnNewExpenseHome')?.addEventListener('click', () => openTxModal('EXPENSE'));
    document.getElementById('btnNewPaymentHome')?.addEventListener('click', () => openTxModal('PAYMENT'));
    document.getElementById('btnNewExpenseTxView')?.addEventListener('click', () => openTxModal('EXPENSE'));
    document.getElementById('btnNewLoan')?.addEventListener('click', () => {
        openTxModal('EXPENSE');
        const respSelect = document.getElementById('txResponsible');
        if (respSelect) {
            respSelect.value = 'Otros';
            respSelect.dispatchEvent(new Event('change'));
        }
    });

    document.getElementById('btnCloseModalTransaction')?.addEventListener('click', () => modalTx.classList.remove('open'));
    document.getElementById('btnCancelTransaction')?.addEventListener('click', () => modalTx.classList.remove('open'));

    document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
        document.getElementById('setCardName').value = appData.settings.cardName;
        document.getElementById('setLast4').value = appData.settings.last4;
        document.getElementById('setHolderName').value = appData.settings.holderName;
        document.getElementById('setCreditLimit').value = appData.settings.creditLimit;
        document.getElementById('setInitialBalance').value = appData.settings.initialBalance || 0;
        document.getElementById('setCreditLimitOffset').value = appData.settings.creditLimitOffset || 0;
        document.getElementById('setClosingDay').value = appData.settings.closingDay;
        document.getElementById('setDueDay').value = appData.settings.dueDay;
        document.getElementById('currencySelectModal').value = appData.settings.currency || DEFAULT_CURRENCY;
        modalSet.classList.add('open');
    });
    document.getElementById('btnCloseModalSettings')?.addEventListener('click', () => modalSet.classList.remove('open'));
    document.getElementById('btnCancelSettings')?.addEventListener('click', () => modalSet.classList.remove('open'));
    document.getElementById('btnEditInitialBalance')?.addEventListener('click', () => {
        document.getElementById('btnOpenSettings')?.click();
        setTimeout(() => document.getElementById('setInitialBalance')?.focus(), 200);
    });

    const modalClosingDate = document.getElementById('modalClosingDate');
    const inputClosingDate = document.getElementById('inputClosingDateOverride');

    document.getElementById('btnEditClosingDate')?.addEventListener('click', () => {
        const { cycleEnd } = getCycleDates(new Date());
        const defaultDateStr = cycleEnd.getFullYear() + '-' + String(cycleEnd.getMonth()+1).padStart(2, '0') + '-' + String(cycleEnd.getDate()).padStart(2, '0');
        const currentOverride = appData.settings.nextClosingOverride || defaultDateStr;
        
        inputClosingDate.value = currentOverride;
        modalClosingDate.classList.add('open');
    });

    document.getElementById('btnCloseModalClosingDate')?.addEventListener('click', () => {
        modalClosingDate.classList.remove('open');
    });

    document.getElementById('btnResetClosingDate')?.addEventListener('click', () => {
        appData.settings.nextClosingOverride = null;
        saveData();
        renderDashboard();
        modalClosingDate.classList.remove('open');
        showToast("Fecha de corte devuelta a modo automático", "info");
    });

    document.getElementById('btnSaveClosingDate')?.addEventListener('click', () => {
        const val = inputClosingDate.value;
        if (!val) {
            appData.settings.nextClosingOverride = null;
            saveData();
            renderDashboard();
            modalClosingDate.classList.remove('open');
            showToast("Fecha de corte devuelta a modo automático", "info");
            return;
        }

        const parts = val.split('-');
        if (parts.length === 3 && parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
            const parsed = new Date(val + 'T00:00:00');
            if (!isNaN(parsed.getTime())) {
                appData.settings.nextClosingOverride = val;
                saveData();
                renderDashboard();
                modalClosingDate.classList.remove('open');
                showToast("Fecha de corte manual actualizada", "success");
            } else {
                showToast("Fecha inválida", "error");
            }
        } else {
            showToast("Formato incorrecto", "error");
        }
    });
    document.getElementById('btnCalibrateLimit')?.addEventListener('click', () => {
        const currentLimit = parseFloat(appData.settings.creditLimit || 500000);
        const { totalDebtAccumulated } = calculateCycleSummary(new Date());
        const currentAvailableWithoutOffset = Math.max(0, currentLimit - totalDebtAccumulated);
        
        const input = prompt("⚖️ CALIBRACIÓN BANCARIA CON SANTANDER:\n\nIngresa tu Cupo Disponible exacto actual según la aplicación del banco (en pesos, ej: 66150):\n\n(Esto sincronizará al instante cualquier diferencia bancaria por Impuesto al Timbre y Estampillas, cobro de mantención o redondeo de cuotas).", Math.round(currentAvailableWithoutOffset));
        if (input !== null && input.trim() !== "") {
            const targetAvailable = parseFloat(input.replace(/[^0-9.-]+/g, ""));
            if (!isNaN(targetAvailable)) {
                const newOffset = targetAvailable - currentAvailableWithoutOffset;
                appData.settings.creditLimitOffset = newOffset;
                saveData();
                renderDashboard();
                showToast("✅ Cupo disponible sincronizado al 100% con Santander", "success");
            }
        }
    });

    document.getElementById('btnExport')?.addEventListener('click', () => modalExp.classList.add('open'));
    document.getElementById('btnCloseModalExport')?.addEventListener('click', () => modalExp.classList.remove('open'));

    document.getElementById('btnImport')?.addEventListener('click', () => document.getElementById('importFileInput').click());
    document.getElementById('importFileInput')?.addEventListener('change', handleImportFile);
    document.getElementById('btnExportJSON')?.addEventListener('click', exportJSON);
    document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);

    document.getElementById('btnMobileTools')?.addEventListener('click', () => modalMobileTools?.classList.add('open'));
    document.getElementById('btnCloseMobileTools')?.addEventListener('click', () => modalMobileTools?.classList.remove('open'));
    document.getElementById('btnMobileSettings')?.addEventListener('click', () => {
        modalMobileTools?.classList.remove('open');
        document.getElementById('btnOpenSettings')?.click();
    });
    document.getElementById('btnMobileExport')?.addEventListener('click', () => {
        modalMobileTools?.classList.remove('open');
        modalExp?.classList.add('open');
    });
    document.getElementById('btnMobileImport')?.addEventListener('click', () => {
        modalMobileTools?.classList.remove('open');
        document.getElementById('importFileInput')?.click();
    });

    // Type selector
    document.getElementById('typeBtnExpense')?.addEventListener('click', () => setTxModalType('EXPENSE'));
    document.getElementById('typeBtnPayment')?.addEventListener('click', () => setTxModalType('PAYMENT'));

    // Dynamic Form Handlers
    const txResponsible = document.getElementById('txResponsible');
    const groupFriendName = document.getElementById('groupFriendName');
    const groupSplitType = document.getElementById('groupSplitType');
    const splitPreviewBox = document.getElementById('splitPreviewBox');
    const txSplitType = document.getElementById('txSplitType');
    const groupCustomSplitAmount = document.getElementById('groupCustomSplitAmount');
    const txCustomFriendAmount = document.getElementById('txCustomFriendAmount');
    const txAmount = document.getElementById('txAmount');

    const updateSplitPreview = () => {
        const resp = txResponsible?.value || 'Yo';
        if (resp === 'Otros' || resp === 'Compartido') {
            groupFriendName.style.display = 'flex';
            groupSplitType.style.display = 'flex';
            splitPreviewBox.style.display = 'flex';
            document.getElementById('txFriendName').required = true;

            const splitVal = txSplitType?.value || '50_50';
            const total = parseFloat(txAmount?.value || 0);
            let friendShare = 0;

            if (splitVal === '50_50') {
                groupCustomSplitAmount.style.display = 'none';
                friendShare = total / 2;
            } else if (splitVal === '100_FRIEND') {
                groupCustomSplitAmount.style.display = 'none';
                friendShare = total;
            } else if (splitVal === 'CUSTOM') {
                groupCustomSplitAmount.style.display = 'flex';
                let customVal = parseFloat(txCustomFriendAmount?.value || 0);
                if (customVal > total) customVal = total;
                friendShare = customVal;
            }

            const myShare = Math.max(0, total - friendShare);
            const previewF = document.getElementById('previewFriendShare');
            const previewM = document.getElementById('previewMyShare');
            if (previewF) previewF.innerText = formatMoney(friendShare);
            if (previewM) previewM.innerText = formatMoney(myShare);
        } else {
            if (groupFriendName) groupFriendName.style.display = 'none';
            if (groupSplitType) groupSplitType.style.display = 'none';
            if (splitPreviewBox) splitPreviewBox.style.display = 'none';
            if (groupCustomSplitAmount) groupCustomSplitAmount.style.display = 'none';
            const friendInp = document.getElementById('txFriendName');
            if (friendInp) friendInp.required = false;
        }
    };

    txResponsible?.addEventListener('change', (e) => {
        if (e.target.value === 'Otros') {
            if (txSplitType) txSplitType.value = '100_FRIEND';
        } else if (e.target.value === 'Compartido') {
            if (txSplitType) txSplitType.value = '50_50';
        }
        updateSplitPreview();
    });
    txSplitType?.addEventListener('change', updateSplitPreview);
    txCustomFriendAmount?.addEventListener('input', updateSplitPreview);

    const txInstallments = document.getElementById('txInstallments');
    const groupCurrentInst = document.getElementById('groupCurrentInst');
    const installmentPreviewBox = document.getElementById('installmentPreviewBox');

    const updateInstPreview = () => {
        const instCount = parseInt(txInstallments.value || 1);
        const amount = parseFloat(txAmount.value || 0);
        if (instCount > 1 && amount > 0) {
            groupCurrentInst.style.display = 'flex';
            installmentPreviewBox.style.display = 'flex';
            const monthly = amount / instCount;
            document.getElementById('previewMonthlyAmount').innerText = formatMoney(monthly);
            const { cycleEnd } = getCycleDates();
            document.getElementById('previewFirstCycle').innerText = cycleEnd.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        } else {
            groupCurrentInst.style.display = 'none';
            installmentPreviewBox.style.display = 'none';
        }
    };
    txInstallments?.addEventListener('change', updateInstPreview);
    txAmount?.addEventListener('input', () => {
        updateInstPreview();
        updateSplitPreview();
    });

    const txStatus = document.getElementById('txStatus');
    const groupPartialAmount = document.getElementById('groupPartialAmount');
    txStatus?.addEventListener('change', (e) => {
        if (e.target.value === 'PARTIAL') {
            groupPartialAmount.style.display = 'flex';
            const total = parseFloat(txAmount.value || 0);
            if (total > 0 && !document.getElementById('txPartialAmount').value) {
                document.getElementById('txPartialAmount').value = Math.round(total / 2);
            }
        } else {
            groupPartialAmount.style.display = 'none';
        }
    });

    // Forms Submit
    document.getElementById('formSettings')?.addEventListener('submit', (e) => {
        e.preventDefault();
        appData.settings.cardName = document.getElementById('setCardName').value.trim() || DEFAULT_CARD_NAME;
        appData.settings.last4 = document.getElementById('setLast4').value.trim() || '4532';
        appData.settings.holderName = document.getElementById('setHolderName').value.trim() || DEFAULT_HOLDER_NAME;
        appData.settings.creditLimit = parseFloat(document.getElementById('setCreditLimit').value) || 1000000;
        appData.settings.initialBalance = parseFloat(document.getElementById('setInitialBalance').value) || 0;
        appData.settings.creditLimitOffset = parseFloat(document.getElementById('setCreditLimitOffset').value) || 0;
        appData.settings.closingDay = parseInt(document.getElementById('setClosingDay').value);
        appData.settings.dueDay = parseInt(document.getElementById('setDueDay').value);
        appData.settings.currency = document.getElementById('currencySelectModal').value || DEFAULT_CURRENCY;
        
        saveData();
        initUI();
        modalSet.classList.remove('open');
        showToast('Configuración guardada exitosamente', 'success');
    });

    document.getElementById('formTransaction')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('txId').value || 'tx_' + Date.now();
        const type = document.getElementById('txType').value;
        const description = document.getElementById('txDescription').value.trim();
        const amount = parseFloat(document.getElementById('txAmount').value);
        const date = document.getElementById('txDate').value;
        const notes = document.getElementById('txNotes').value.trim();
        const status = document.getElementById('txStatus').value;

        let category = 'Otros'; let responsible = 'Yo'; let friendName = '';
        let installments = 1; let currentInstallment = 1; let partialPaidAmount = 0; let friendPaidInstallments = 0;
        let splitType = '50_50'; let customFriendAmount = null;

        if (type === 'EXPENSE') {
            category = document.getElementById('txCategory').value;
            responsible = document.getElementById('txResponsible').value;
            if (responsible === 'Otros' || responsible === 'Compartido') {
                friendName = document.getElementById('txFriendName').value.trim();
                addFriendToMemory(friendName);
                splitType = document.getElementById('txSplitType')?.value || '50_50';
                if (splitType === 'CUSTOM') {
                    customFriendAmount = parseFloat(document.getElementById('txCustomFriendAmount')?.value || 0);
                } else if (splitType === '100_FRIEND') {
                    customFriendAmount = amount;
                } else if (splitType === '50_50') {
                    customFriendAmount = amount / 2;
                }
            }
            installments = parseInt(document.getElementById('txInstallments').value || 1);
            if (installments > 1) {
                currentInstallment = parseInt(document.getElementById('txCurrentInst').value || 1);
            }
            if (status === 'PARTIAL') {
                partialPaidAmount = parseFloat(document.getElementById('txPartialAmount').value) || 0;
                if (installments > 1 && (responsible === 'Otros' || responsible === 'Compartido')) {
                    const instVal = (customFriendAmount !== null ? customFriendAmount : (amount / 2)) / installments;
                    friendPaidInstallments = Math.min(installments - 1, Math.max(1, Math.round(partialPaidAmount / instVal)));
                }
            } else if (status === 'PAID') {
                partialPaidAmount = amount;
                if (installments > 1 && (responsible === 'Otros' || responsible === 'Compartido')) {
                    friendPaidInstallments = installments;
                }
            }
        } else {
            category = 'Abono / Pago';
            responsible = 'Yo';
        }

        const txObj = {
            id, type, description, amount, date, notes, status,
            category, responsible, friendName, installments, currentInstallment, partialPaidAmount, friendPaidInstallments, splitType, customFriendAmount
        };

        const existingIndex = appData.transactions.findIndex(t => t.id === id);
        if (existingIndex >= 0) {
            appData.transactions[existingIndex] = txObj;
            showToast('Movimiento actualizado', 'info');
        } else {
            appData.transactions.unshift(txObj);
            showToast(type === 'EXPENSE' ? 'Compra registrada' : 'Abono registrado', 'success');
        }

        saveData();
        modalTx.classList.remove('open');
    });

    // Filters
    document.getElementById('filterCycle')?.addEventListener('change', renderTransactionsTable);
    document.getElementById('filterType')?.addEventListener('change', renderTransactionsTable);
    document.getElementById('filterResponsible')?.addEventListener('change', renderTransactionsTable);

    // Loans filter pills
    document.querySelectorAll('.loan-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            document.querySelectorAll('.loan-pill').forEach(p => p.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeLoanFilter = e.currentTarget.getAttribute('data-loan-filter');
            renderDebtorsView();
        });
    });
}

function setTxModalType(type) {
    document.getElementById('txType').value = type;
    const btnExp = document.getElementById('typeBtnExpense');
    const btnPay = document.getElementById('typeBtnPayment');
    const title = document.getElementById('modalTransactionTitle');
    const groupCatResp = document.getElementById('groupCategoryResp');
    const groupInst = document.getElementById('groupInstallments');
    const paymentBox = document.getElementById('paymentHelperBox');

    if (type === 'EXPENSE') {
        btnExp?.classList.add('active'); btnPay?.classList.remove('active');
        if (title) title.innerText = 'Registrar Compra / Gasto';
        if (groupCatResp) groupCatResp.style.display = 'flex';
        if (groupInst) groupInst.style.display = 'flex';
        if (paymentBox) paymentBox.style.display = 'none';
        document.getElementById('txStatus').value = 'PENDING';
        document.getElementById('txStatus').disabled = false;
    } else {
        btnPay?.classList.add('active'); btnExp?.classList.remove('active');
        if (title) title.innerText = 'Registrar Abono a Tarjeta';
        if (groupCatResp) groupCatResp.style.display = 'none';
        if (groupInst) groupInst.style.display = 'none';
        if (paymentBox) {
            paymentBox.style.display = 'flex';
            const { totalPeriodRemaining } = calculateCycleSummary(new Date());
            document.getElementById('helperRemainingPay').innerText = formatMoney(totalPeriodRemaining);
        }
        document.getElementById('txStatus').value = 'PAID';
        document.getElementById('txStatus').disabled = true;
    }
}

function resetTxForm() {
    document.getElementById('formTransaction')?.reset();
    document.getElementById('txId').value = '';
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('groupFriendName').style.display = 'none';
    const groupSplit = document.getElementById('groupSplitType');
    if (groupSplit) groupSplit.style.display = 'none';
    const splitPrev = document.getElementById('splitPreviewBox');
    if (splitPrev) splitPrev.style.display = 'none';
    const groupCust = document.getElementById('groupCustomSplitAmount');
    if (groupCust) groupCust.style.display = 'none';
    document.getElementById('groupCurrentInst').style.display = 'none';
    document.getElementById('installmentPreviewBox').style.display = 'none';
    document.getElementById('groupPartialAmount').style.display = 'none';
}

// --- RENDER FUNCTIONS ---
function renderAll() {
    renderDashboard();
    renderDebtorsView();
    renderCycleFilterOptions();
    renderTransactionsTable();
    renderInstallmentsView();
    updateSidebarBadges();
}

function updateSidebarBadges() {
    // Badges numéricos eliminados del sidebar según preferencia de diseño minimalista del usuario.
}

// 1. DASHBOARD
function renderDashboard() {
    document.getElementById('displayCardName').innerText = appData.settings.cardName || DEFAULT_CARD_NAME;
    document.getElementById('displayLast4').innerText = appData.settings.last4 || '4532';
    document.getElementById('displayHolderName').innerText = appData.settings.holderName || DEFAULT_HOLDER_NAME;
    document.getElementById('displayClosingDay').innerText = appData.settings.closingDay;
    document.getElementById('displayDueDay').innerText = appData.settings.dueDay;

    const { totalExpense, totalPaid, remaining, totalDebtAccumulated, activeExpensesCount, paidItemsPercent, avgTicket, totalPrestamos, initialBal, totalPeriodDebt, totalPeriodRemaining } = calculateCycleSummary(new Date());

    document.getElementById('statStatementBalance').innerText = formatMoney(totalExpense);
    document.getElementById('statPaidThisCycle').innerText = formatMoney(totalPaid);
    document.getElementById('statRemainingToPay').innerText = formatMoney(remaining);
    const totalPeriodElem = document.getElementById('statTotalPeriodDebt');
    if (totalPeriodElem) {
        totalPeriodElem.innerText = formatMoney(totalPeriodDebt);
        if (initialBal === 0) {
            totalPeriodElem.classList.remove('mb-4');
        } else {
            totalPeriodElem.classList.add('mb-4');
        }
    }

    const initialDisplay = document.getElementById('statInitialBalanceDisplay');
    if (initialDisplay) initialDisplay.innerText = formatMoney(initialBal);
    
    const breakdownRow = document.getElementById('debtBreakdownRow');
    if (breakdownRow) {
        breakdownRow.style.display = initialBal === 0 ? 'none' : 'flex';
    }

    const progBar = document.getElementById('paymentProgressBar');
    const badge = document.getElementById('statementStatusBadge');
    let payPercent = totalExpense > 0 ? Math.min(100, Math.round((totalPaid / totalExpense) * 100)) : 100;
    if (progBar) progBar.style.width = `${payPercent}%`;
    
    if (badge) {
        if (totalPeriodRemaining <= 0) {
            badge.className = 'badge badge-green text-xs'; badge.innerText = '✅ Periodo Saldado';
        } else if (totalPaid > 0) {
            badge.className = 'badge badge-yellow text-xs'; badge.innerText = `🌗 Abono Parcial (${payPercent}%)`;
        } else {
            badge.className = 'badge badge-outline text-xs'; badge.innerText = '⏳ Pendiente';
        }
    }

    const limit = parseFloat(appData.settings.creditLimit || 1000000);
    const offset = parseFloat(appData.settings.creditLimitOffset || 0);
    const available = Math.max(0, limit - totalDebtAccumulated + offset);
    const adjustedDebt = Math.max(0, totalDebtAccumulated - offset);
    const utilPercent = Math.min(100, Math.round((adjustedDebt / limit) * 100));

    const limitElem = document.getElementById('creditLimitTextInner');
    if (limitElem) limitElem.innerText = formatMoney(limit);
    
    document.getElementById('statAvailableCredit').innerText = formatMoney(available);
    document.getElementById('statTotalDebt').innerText = formatMoney(adjustedDebt);
    document.getElementById('utilizationPercent').innerText = `${utilPercent}%`;

    const progressBar = document.getElementById('utilizationProgressBar');
    const utilBadge = document.getElementById('utilizationBadge');
    
    if (progressBar) {
        progressBar.style.width = `${utilPercent}%`;
        
        // Remove old color classes
        progressBar.classList.remove('emerald', 'amber', 'rose');
        
        let colorClass = 'emerald';
        if (utilPercent > 80) colorClass = 'rose';
        else if (utilPercent > 50) colorClass = 'amber';
        
        progressBar.classList.add(colorClass);
    }
    
    if (utilBadge) {
        utilBadge.className = 'utilization-badge ' + (utilPercent > 80 ? 'badge-red' : utilPercent > 50 ? 'badge-yellow' : 'badge-green');
    }

    // KPIs
    const kpiAvg = document.getElementById('kpiTicketPromedio');
    if (kpiAvg) kpiAvg.innerText = formatMoney(avgTicket);
    
    const kpiPrestamos = document.getElementById('kpiPrestamosHome');
    if (kpiPrestamos) kpiPrestamos.innerText = formatMoney(totalPrestamos);
    
    const kpiCompras = document.getElementById('kpiNumCompras');
    if (kpiCompras) kpiCompras.innerText = activeExpensesCount;
    
    const kpiPagados = document.getElementById('kpiItemsPagados');
    if (kpiPagados) kpiPagados.innerText = `${paidItemsPercent}%`;

    // Countdowns
    const { cycleEnd: defaultCycleEnd, dueDate } = getCycleDates(new Date());
    const now = new Date();
    
    let displayCycleEnd = defaultCycleEnd;
    if (appData.settings.nextClosingOverride) {
        const overrideDate = new Date(appData.settings.nextClosingOverride + 'T00:00:00');
        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (overrideDate < nowMidnight) {
            appData.settings.nextClosingOverride = null;
            saveData();
        } else {
            displayCycleEnd = overrideDate;
        }
    }

    const daysToClose = Math.ceil((displayCycleEnd - now) / (1000 * 60 * 60 * 24));
    const daysToDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    document.getElementById('nextClosingDateDisplay').innerText = displayCycleEnd.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    document.getElementById('nextClosingDaysBadge').innerText = daysToClose >= 0 ? `Faltan ${daysToClose} días` : 'Cortado hoy';
    document.getElementById('nextDueDateDisplay').innerText = dueDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    document.getElementById('nextDueDaysBadge').innerText = daysToDue >= 0 ? `Faltan ${daysToDue} días` : 'Venció';

    if (typeof renderDashboardBottomRow === 'function') {
        renderDashboardBottomRow();
    }
}

// --- RENDERING BOTTOM ROW ---
function renderDashboardBottomRow() {
    const container = document.getElementById('recentPurchasesList');
    if (!container) return;

    // Calcular resumen del ciclo actual usando la misma lógica de los KPIs
    const { topCategory, topCategoryAmount } = calculateCycleSummary(new Date());

    const summarySpan = document.getElementById('recentPurchasesSummary');
    if (summarySpan) {
        if (topCategory && topCategoryAmount > 0) {
            summarySpan.innerHTML = `
                <span class="recent-summary-label">Mayor gasto:</span>
                <span class="recent-summary-category">${getCategoryBadgeHtml(topCategory)}</span>
                <span class="recent-summary-separator" aria-hidden="true">&bull;</span>
                <strong class="recent-summary-amount">${formatMoney(topCategoryAmount)}</strong>
            `;
        } else {
            summarySpan.innerText = 'Sin gastos registrados este ciclo';
        }
    }

    // Obtener las últimas 5 transacciones de tipo EXPENSE (compras)
    const expenses = appData.transactions.filter(tx => tx.type === 'EXPENSE');
    const sorted = expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = sorted.slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = `<div class="text-center text-muted p-3 text-sm">No hay compras registradas.</div>`;
        return;
    }

    container.innerHTML = recent.map(tx => {
        const dateStr = new Date(tx.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        const isPaid = tx.status === 'PAID';
        
        const catClass = getCategoryClass(tx.category);
        const iconName = getCategoryIconName(tx.category);
        
        return `
            <div class="recent-purchase-row">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div class="tx-icon-circle ${catClass}" style="background-image: none; opacity: 1; box-shadow: none;">
                        <i data-lucide="${iconName}" style="width: 18px; height: 18px; opacity: 0.9;"></i>
                    </div>
                    <div class="flex-col">
                        <span style="font-size: 14px; font-weight: 600; color: #fff;">${tx.description}</span>
                        <span style="font-size: 12px; color: var(--text-muted);">${dateStr}</span>
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; gap: 20px;">
                    <span style="font-size: 15px; font-weight: 700; color: #fff; font-family: var(--font-heading);">${formatMoney(tx.amount)}</span>
                    <span class="badge ${isPaid ? 'badge-green' : 'badge-yellow'}" style="min-width: 70px; text-align: center;">
                        ${isPaid ? 'Pagado' : 'Pendiente'}
                    </span>
                </div>
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
}

function calculateCycleSummary(refDate = new Date()) {
    const { cycleStart, cycleEnd } = getCycleDates(refDate);
    const initialBal = parseFloat(appData.settings.initialBalance || 0);
    
    let totalExpense = 0; // Gastos puros del mes en curso (calza 100% con Excel del usuario)
    let totalPaid = 0;
    let totalDebtAccumulated = initialBal;
    let activeExpensesCount = 0;
    let paidItemsCount = 0;
    let totalPrestamos = 0;
    
    const categoryTotals = {};

    appData.transactions.forEach(tx => {
        const txDate = new Date(tx.date + 'T00:00:00');
        const inCycle = txDate >= cycleStart && txDate <= cycleEnd;

        if (tx.type === 'EXPENSE') {
            let instAmount = tx.amount;
            const isInst = (tx.installments || 1) > 1;
            let isExpenseInCycle = inCycle;
            
            if (isInst) {
                instAmount = tx.amount / tx.installments;
                const { cycleEnd: txCycleEnd } = getCycleDates(txDate);
                const monthDiff = (cycleEnd.getFullYear() - txCycleEnd.getFullYear()) * 12 + (cycleEnd.getMonth() - txCycleEnd.getMonth());
                isExpenseInCycle = (monthDiff >= 0 && monthDiff < tx.installments);
            }

            // 1. Cálculo exacto de Deuda Acumulada / Utilizado en Santander
            if (tx.responsible === 'Otros' || tx.responsible === 'Compartido') {
                // En Santander, un préstamo u operación a terceros sigue ocupando cupo hasta que TÚ le pagas al banco.
                // El reembolso de tu amigo no reduce tu deuda con Santander.
                if (isInst) {
                    const pastPaidInst = Math.max(0, (tx.currentInstallment || 1) - 1);
                    const pastPaidAmount = instAmount * pastPaidInst;
                    totalDebtAccumulated += Math.max(0, tx.amount - pastPaidAmount);
                } else {
                    totalDebtAccumulated += tx.amount;
                }
            } else {
                // Gastos personales ('Yo')
                if (tx.status !== 'PAID') {
                    if (isInst) {
                        const pastPaidInst = Math.max(0, (tx.currentInstallment || 1) - 1);
                        const pastPaidAmount = instAmount * pastPaidInst;
                        const partial = (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) ? tx.partialPaidAmount : 0;
                        totalDebtAccumulated += Math.max(0, tx.amount - pastPaidAmount - partial);
                    } else if (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) {
                        totalDebtAccumulated += (tx.amount - tx.partialPaidAmount);
                    } else {
                        totalDebtAccumulated += tx.amount;
                    }
                }
            }

            if (isExpenseInCycle) {
                totalExpense += instAmount;
                activeExpensesCount++;
                categoryTotals[tx.category || 'Otros'] = (categoryTotals[tx.category || 'Otros'] || 0) + instAmount;
                // SOLO los gastos personales ('Yo') marcados como pagados al banco
                // cuentan como pagos realizados A LA TARJETA en este ciclo.
                if (tx.responsible === 'Yo' || !tx.responsible) {
                    if (tx.status === 'PAID') {
                        totalPaid += instAmount;
                        paidItemsCount++;
                    } else if (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) {
                        totalPaid += Math.min(instAmount, tx.partialPaidAmount);
                    }
                }
            }

            if ((tx.responsible === 'Otros' || tx.responsible === 'Compartido') && tx.status !== 'PAID') {
                let share = getFriendShare(tx);
                if (isInst) {
                    const paidInst = tx.friendPaidInstallments || 0;
                    const instVal = share / tx.installments;
                    const pendingShare = Math.max(0, share - (instVal * paidInst));
                    totalPrestamos += pendingShare;
                } else if (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) {
                    let pendingShare = Math.max(0, share - tx.partialPaidAmount);
                    totalPrestamos += pendingShare;
                } else {
                    totalPrestamos += share;
                }
            }
        } else if (tx.type === 'PAYMENT') {
            if (inCycle) {
                totalPaid += tx.amount;
            }
            // Los abonos directos reducen la deuda acumulada del banco
            totalDebtAccumulated = Math.max(0, totalDebtAccumulated - tx.amount);
        }
    });

    const totalPeriodDebt = initialBal + totalExpense;
    const totalPeriodRemaining = Math.max(0, totalPeriodDebt - totalPaid);
    const remaining = Math.max(0, totalExpense - totalPaid);
    const paidItemsPercent = activeExpensesCount > 0 ? Math.round((paidItemsCount / activeExpensesCount) * 100) : 0;
    const avgTicket = activeExpensesCount > 0 ? totalExpense / activeExpensesCount : 0;

    let topCategory = null;
    let topCategoryAmount = 0;
    for (const [cat, amt] of Object.entries(categoryTotals)) {
        if (amt > topCategoryAmount) {
            topCategoryAmount = amt;
            topCategory = cat;
        }
    }

    return { totalExpense, totalPaid, remaining, totalDebtAccumulated, activeExpensesCount, paidItemsPercent, avgTicket, totalPrestamos, initialBal, totalPeriodDebt, totalPeriodRemaining, topCategory, topCategoryAmount };
}

// 2. DEBTORS VIEW (¿QUIÉN ME DEBE? — CON CONTROL INTELIGENTE DE CUOTAS Y BOTÓN DESHACER)
function getDebtorsSummary() {
    const map = {};
    appData.transactions.forEach(tx => {
        if (tx.type === 'EXPENSE' && (tx.responsible === 'Otros' || tx.responsible === 'Compartido')) {
            const name = (tx.friendName || 'Persona sin nombre').trim();
            if (!map[name]) map[name] = { totalPending: 0, items: [] };
            
            let share = getFriendShare(tx);
            let pendingShare = share;
            let friendPaidAmount = 0;
            const isInstallment = (tx.installments || 1) > 1;

            if (tx.status === 'PAID') {
                pendingShare = 0;
                friendPaidAmount = share;
            } else if (isInstallment) {
                const totalInst = tx.installments;
                const paidInst = tx.friendPaidInstallments || 0;
                const instVal = share / totalInst;
                friendPaidAmount = instVal * paidInst;
                pendingShare = Math.max(0, share - friendPaidAmount);
            } else if (tx.status === 'PARTIAL' && tx.partialPaidAmount > 0) {
                friendPaidAmount = tx.partialPaidAmount;
                pendingShare = Math.max(0, share - tx.partialPaidAmount);
            }

            map[name].items.push({ 
                ...tx, 
                shareAmount: share, 
                pendingAmount: pendingShare, 
                friendPaidAmount,
                isInstallment
            });
            map[name].totalPending += pendingShare;
        }
    });

    return Object.keys(map).map(name => ({
        name,
        totalPending: map[name].totalPending,
        items: map[name].items
    })).sort((a, b) => b.totalPending - a.totalPending);
}

function renderDebtorsView() {
    const grid = document.getElementById('debtorsCardsGrid');
    const emptyState = document.getElementById('emptyLoansState');
    const totalDisplay = document.getElementById('displayTotalLoansPending');
    if (!grid || !emptyState || !totalDisplay) return;

    let debtors = getDebtorsSummary();
    
    // Filtrar por pildora activa
    if (activeLoanFilter !== 'ALL') {
        debtors = debtors.map(d => ({
            name: d.name,
            items: d.items.filter(it => it.responsible === activeLoanFilter),
            totalPending: d.items.filter(it => it.responsible === activeLoanFilter).reduce((acc, it) => acc + it.pendingAmount, 0)
        })).filter(d => d.items.length > 0);
    }

    const totalAll = debtors.reduce((acc, d) => acc + d.totalPending, 0);
    totalDisplay.innerText = formatMoney(totalAll);

    if (debtors.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = debtors.map(d => {
        const initial = d.name.charAt(0).toUpperCase();
        const itemsHtml = d.items.map(it => {
            const dateStr = new Date(it.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
            let statusBadge = '';
            let actionHtml = '';
            let undoHtml = '';

            if (it.status === 'PAID' || it.pendingAmount <= 0) {
                statusBadge = `<span class="badge badge-green text-xs" style="padding: 2px 8px; font-size: 10.5px;">✅ Saldado</span>`;
                if (it.isInstallment && (it.friendPaidInstallments || 0) > 0) {
                    undoHtml = `
                        <button class="btn btn-outline btn-xs" onclick="undoFriendInstallment('${it.id}')" title="Deshacer cuota cobrada a ${d.name}">
                            <i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> Deshacer (${it.friendPaidInstallments}/${it.installments})
                        </button>
                    `;
                }
            } else if (it.isInstallment) {
                const totalInst = it.installments;
                const paidInst = it.friendPaidInstallments || 0;
                const instValue = Math.round(it.shareAmount / totalInst);
                const progPercent = Math.round((paidInst / totalInst) * 100);

                statusBadge = `
                    <div style="margin-top: 3px; width: 100%; max-width: 220px;">
                        <div class="flex-row" style="justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                            <span class="text-purple font-semibold">Cuota ${paidInst}/${totalInst}</span>
                            <span class="text-muted">${formatMoney(it.friendPaidAmount)} pagado</span>
                        </div>
                        <div class="friend-inst-progress-bar">
                            <div class="progress-bar-fill purple" style="width: ${progPercent}%;"></div>
                        </div>
                    </div>
                `;

                if (paidInst > 0) {
                    undoHtml = `
                        <button class="btn btn-outline btn-xs" onclick="undoFriendInstallment('${it.id}')" title="Volver atrás 1 cuota cobrada a ${d.name}">
                            <i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> -1 cuota
                        </button>
                    `;
                }

                if (paidInst < totalInst) {
                    actionHtml = `
                        <button class="btn btn-purple btn-xs" onclick="collectNextFriendInstallment('${it.id}')" title="Cobrar cuota ${paidInst + 1} de ${totalInst} a ${d.name}">
                            <i data-lucide="plus-circle" style="width:13px;height:13px;"></i> Cobrar ${paidInst + 1}/${totalInst} (+${formatMoney(instValue)})
                        </button>
                    `;
                }
            } else if (it.status === 'PARTIAL') {
                statusBadge = `<span class="badge badge-yellow text-xs" style="padding: 2px 8px; font-size: 10.5px;">🌗 Restan ${formatMoney(it.pendingAmount)}</span>`;
                actionHtml = `
                    <button class="btn btn-emerald btn-xs" onclick="markLoanItemPaid('${it.id}')" title="Cobrar saldo restante a ${d.name}">
                        <i data-lucide="check" style="width:13px;height:13px;"></i> Cobrar ${formatMoney(it.pendingAmount)}
                    </button>
                `;
            } else {
                statusBadge = `<span class="badge badge-red text-xs" style="padding: 2px 8px; font-size: 10.5px;">⏳ Pendiente</span>`;
                actionHtml = `
                    <button class="btn btn-emerald btn-xs" onclick="markLoanItemPaid('${it.id}')" title="Marcar como cobrado a ${d.name}">
                        <i data-lucide="check" style="width:13px;height:13px;"></i> Cobrar ${formatMoney(it.shareAmount)}
                    </button>
                `;
            }

            return `
                <div class="debtor-item-row">
                    <div class="debtor-item-main" style="flex: 1; min-width: 180px;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span class="debtor-item-title">${it.description}</span>
                            <span class="badge badge-outline" style="font-size: 10px; padding: 1px 6px;">${it.responsible}</span>
                        </div>
                        <div class="debtor-item-meta">${dateStr} • Total compra: ${formatMoney(it.shareAmount)}</div>
                        ${statusBadge}
                    </div>
                    <div class="debtor-item-summary" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                        <span class="debtor-item-amount ${it.pendingAmount > 0 ? 'text-purple' : 'text-emerald'}" style="font-size: 15px;">${formatMoney(it.pendingAmount > 0 ? it.pendingAmount : 0)}</span>
                        <div class="debtor-item-actions" style="display: flex; gap: 6px; align-items: center;">
                            ${undoHtml}
                            ${actionHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="debtor-person-card">
                <div class="debtor-header">
                    <div class="debtor-avatar-name">
                        <div class="debtor-avatar">${initial}</div>
                        <div class="debtor-name-info">
                            <h3>${d.name}</h3>
                            <span>${d.items.length} préstamo(s) registrado(s)</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="debtor-total-label">Por cobrar</span>
                        <div class="debtor-total-val">${formatMoney(d.totalPending)}</div>
                    </div>
                </div>
                <div class="debtor-items-list">
                    ${itemsHtml}
                </div>
                ${d.totalPending > 0 ? `
                    <div class="debtor-card-footer" style="padding: 8px 14px; background: rgba(0,0,0,0.25); border-top: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center;">
                        <span class="text-xs text-muted">¿Pagó todo de una vez?</span>
                        <button class="btn btn-emerald btn-xs" onclick="markAllLoansPaidForPerson('${d.name}')">
                            <i data-lucide="check-check" style="width:14px;height:14px;"></i> Saldar todo con ${d.name} (${formatMoney(d.totalPending)})
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

window.collectNextFriendInstallment = function(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if (!tx || !(tx.installments > 1)) return;

    const totalInst = tx.installments;
    let paidInst = tx.friendPaidInstallments || 0;

    if (paidInst < totalInst) {
        paidInst++;
        tx.friendPaidInstallments = paidInst;
        
        let share = getFriendShare(tx);
        const instVal = share / totalInst;
        const friendPaidAmount = instVal * paidInst;

        if (paidInst >= totalInst) {
            tx.status = 'PAID';
            tx.partialPaidAmount = tx.amount;
        } else {
            tx.status = 'PARTIAL';
            if (tx.responsible === 'Compartido') {
                tx.partialPaidAmount = friendPaidAmount * 2;
            } else {
                tx.partialPaidAmount = friendPaidAmount;
            }
        }

        saveData();
        const remainingDebt = Math.max(0, share - friendPaidAmount);
        showToast(`¡Cuota ${paidInst}/${totalInst} cobrada a ${tx.friendName || 'esta persona'}! Deuda restante: ${formatMoney(remainingDebt)}`, 'success');
    }
};

window.undoFriendInstallment = function(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if (!tx || !(tx.installments > 1)) return;

    let paidInst = tx.friendPaidInstallments || 0;
    if (paidInst > 0) {
        paidInst--;
        tx.friendPaidInstallments = paidInst;
        
        let share = getFriendShare(tx);
        const instVal = share / tx.installments;
        const friendPaidAmount = instVal * paidInst;

        if (paidInst === 0) {
            tx.status = 'PENDING';
            tx.partialPaidAmount = 0;
        } else {
            tx.status = 'PARTIAL';
            if (tx.responsible === 'Compartido') {
                tx.partialPaidAmount = friendPaidAmount * 2;
            } else {
                tx.partialPaidAmount = friendPaidAmount;
            }
        }

        saveData();
        const remainingDebt = Math.max(0, share - friendPaidAmount);
        showToast(`↩️ Cuota deshecha. Ahora cobradas: ${paidInst}/${tx.installments}. Deuda pendiente: ${formatMoney(remainingDebt)}`, 'info');
    }
};

window.markLoanItemPaid = function(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if (tx) {
        tx.status = 'PAID';
        tx.partialPaidAmount = tx.amount;
        if ((tx.installments || 1) > 1) {
            tx.friendPaidInstallments = tx.installments;
        }
        saveData();
        showToast('Préstamo marcado como cobrado en su totalidad', 'success');
    }
};

window.markAllLoansPaidForPerson = function(personName) {
    let count = 0;
    appData.transactions.forEach(tx => {
        if (tx.type === 'EXPENSE' && (tx.responsible === 'Otros' || tx.responsible === 'Compartido') && (tx.friendName || '').trim() === personName && tx.status !== 'PAID') {
            tx.status = 'PAID';
            tx.partialPaidAmount = tx.amount;
            if ((tx.installments || 1) > 1) {
                tx.friendPaidInstallments = tx.installments;
            }
            count++;
        }
    });
    if (count > 0) {
        saveData();
        showToast(`Se cobraron ${count} préstamo(s) pendientes de ${personName}`, 'success');
    }
};

// 3. TRANSACTIONS TABLE WITH 12-COLOR CATEGORY BADGES & SUBTLE NOTES
function renderCycleFilterOptions() {
    const filterCycle = document.getElementById('filterCycle');
    if (!filterCycle) return;
    
    const currentVal = filterCycle.value || 'ALL';
    const cyclesMap = new Map();
    
    appData.transactions.forEach(tx => {
        const label = getCycleLabel(tx.date);
        if (!cyclesMap.has(label)) {
            const cycleStart = getCycleDates(new Date(tx.date)).cycleStart;
            cyclesMap.set(label, cycleStart.getTime());
        }
    });

    let html = `<option value="ALL">Todos los ciclos de corte</option>`;
    const sortedCycles = Array.from(cyclesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
        
    sortedCycles.forEach(c => {
        html += `<option value="${c}">${c}</option>`;
    });

    filterCycle.innerHTML = html;
    filterCycle.value = currentVal;
    if (filterCycle.syncCustomUI) filterCycle.syncCustomUI();
}

function getCategoryClass(catName) {
    const name = (catName || 'Otros').trim();
    const map = {
        'Supermercado': 'badge-cat-supermercado',
        'Comida': 'badge-cat-comida',
        'Comida y Restaurantes': 'badge-cat-comida',
        'Transporte': 'badge-cat-transporte',
        'Transporte y Uber': 'badge-cat-transporte',
        'Suscripciones': 'badge-cat-suscripciones',
        'Hogar': 'badge-cat-hogar',
        'Cursos y capacitaciones': 'badge-cat-cursos',
        'Cursos y Capacitaciones': 'badge-cat-cursos',
        'Salud': 'badge-cat-salud',
        'Salud y Farmacia': 'badge-cat-salud',
        'Cuidado personal': 'badge-cat-cuidado',
        'Cuidado Personal': 'badge-cat-cuidado',
        'Regalos': 'badge-cat-regalos',
        'Alcohol': 'badge-cat-alcohol',
        'Alcohol y Carrete': 'badge-cat-alcohol',
        'Viajes': 'badge-cat-viajes',
        'Viajes y Pasajes': 'badge-cat-viajes',
        'Otros': 'badge-cat-otros'
    };
    return map[name] || 'badge-cat-otros';
}

function getCategoryIconName(catName) {
    const name = (catName || 'Otros').trim();
    const map = {
        'Supermercado': 'shopping-cart',
        'Comida': 'utensils',
        'Comida y Restaurantes': 'utensils',
        'Transporte': 'car',
        'Transporte y Uber': 'car',
        'Suscripciones': 'play-circle',
        'Hogar': 'home',
        'Cursos y capacitaciones': 'book-open',
        'Cursos y Capacitaciones': 'book-open',
        'Salud': 'activity',
        'Salud y Farmacia': 'activity',
        'Cuidado personal': 'smile',
        'Cuidado Personal': 'smile',
        'Regalos': 'gift',
        'Alcohol': 'wine',
        'Alcohol y Carrete': 'wine',
        'Viajes': 'plane',
        'Viajes y Pasajes': 'plane',
        'Otros': 'tag'
    };
    return map[name] || 'tag';
}

function getCategoryBadgeHtml(catName) {
    const className = getCategoryClass(catName);
    return `<span class="badge-category ${className}">${catName}</span>`;
}

function renderTransactionsTable() {
    const tbody = document.getElementById('transactionsListBody');
    const emptyState = document.getElementById('emptyTransactionsState');
    const countDisplay = document.getElementById('countTransactions');
    if (!tbody || !emptyState) return;

    const filterCycle = document.getElementById('filterCycle')?.value || 'ALL';
    const filterType = document.getElementById('filterType')?.value || 'ALL';
    const filterResp = document.getElementById('filterResponsible')?.value || 'ALL';

    const filtered = appData.transactions.filter(tx => {
        if (filterCycle !== 'ALL' && getCycleLabel(tx.date) !== filterCycle) return false;
        if (filterType !== 'ALL' && tx.type !== filterType) return false;
        if (filterResp !== 'ALL' && tx.responsible !== filterResp) return false;
        return true;
    });

    if (countDisplay) countDisplay.innerText = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    tbody.innerHTML = filtered.map(tx => {
        const dateStr = new Date(tx.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        
        // Badge de Categoría con 12 Colores Curados
        const catBadge = tx.type === 'EXPENSE' ? getCategoryBadgeHtml(tx.category) : `<span class="badge badge-outline text-xs">Abono</span>`;
        
        let respBadge = '';
        if (tx.responsible === 'Yo') respBadge = `<span class="badge-resp-yo">👤 Yo</span>`;
        else if (tx.responsible === 'Otros') respBadge = `<span class="badge-resp-otros">👤 ${tx.friendName || 'Sin nombre'}</span>`;
        else respBadge = `<span class="badge-resp-comp">👥 ${tx.friendName || 'Sin nombre'} (Comp.)</span>`;

        let instText = '1 cuota';
        if ((tx.installments || 1) > 1) {
            instText = `Cuota ${tx.currentInstallment || 1}/${tx.installments}`;
        }

        let statusBtn = '';
        let remainingSubtextHtml = '';
        const isInst = (tx.installments || 1) > 1;
        const instVal = isInst ? tx.amount / tx.installments : tx.amount;
        const isFriendInstallment = isInst && (tx.responsible === 'Otros' || tx.responsible === 'Compartido');

        if (isFriendInstallment) {
            const paidInst = tx.friendPaidInstallments || 0;
            const currInst = tx.currentInstallment || 1;

            if (paidInst >= currInst) {
                statusBtn = `<button class="btn-status-toggle paid" onclick="toggleTxStatus('${tx.id}')" title="Cuota de este mes ya cobrada. Clic para deshacer">✅ Pagado</button>`;
            } else {
                statusBtn = `<button class="btn-status-toggle pending" onclick="toggleTxStatus('${tx.id}')" title="Cuota de este mes aún no cobrada. Clic para cobrar">⏳ Pendiente</button>`;
            }
        } else if (tx.status === 'PAID') {
            statusBtn = `<button class="btn-status-toggle paid" onclick="toggleTxStatus('${tx.id}')" title="Marcar pendiente">✅ Pagado</button>`;
        } else if (tx.status === 'PARTIAL') {
            statusBtn = `<button class="btn-status-toggle partial" onclick="toggleTxStatus('${tx.id}')" title="Marcar saldado">🌗 Parcial</button>`;
            const totalToPay = isInst ? instVal : tx.amount;
            const paid = tx.partialPaidAmount || 0;
            const remaining = Math.max(0, totalToPay - paid);
            if (paid > 0) {
                remainingSubtextHtml = `
                    <div class="financial-sub-pills" style="display: flex; gap: 4px; margin-top: 6px;">
                        <span class="sub-pill" style="font-size: 10px; font-weight: 600; padding: 3px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.12); color: #10b981; display: inline-flex; align-items: center; gap: 3px;">
                            <i data-lucide="check" style="width: 10px; height: 10px;"></i> ${formatMoney(paid)}
                        </span>
                        <span class="sub-pill" style="font-size: 10px; font-weight: 600; padding: 3px 6px; border-radius: 4px; background: rgba(245, 158, 11, 0.12); color: #f59e0b; display: inline-flex; align-items: center; gap: 3px;">
                            <i data-lucide="clock" style="width: 10px; height: 10px;"></i> ${formatMoney(remaining)}
                        </span>
                    </div>
                `;
            }
        } else {
            statusBtn = `<button class="btn-status-toggle pending" onclick="toggleTxStatus('${tx.id}')" title="Marcar pagado">⏳ Pendiente</button>`;
        }

        const amountClass = tx.type === 'EXPENSE' ? 'text-main font-bold' : 'text-emerald font-bold';
        const amountSign = tx.type === 'EXPENSE' ? '+ ' : '- ';

        // Comentarios / Notas de color gris sutil con ícono diminuto, completamente diferenciado en tipografía
        const notesHtml = tx.notes ? `<div class="tx-note-subtle" title="${tx.notes}"><i data-lucide="message-square" class="icon-tiny"></i> <span>${tx.notes}</span></div>` : '';

        return `
            <div class="tx-row">
                <div class="tx-row-identity">
                    <!-- Icono Circular -->
                    <div class="tx-icon-circle ${tx.type === 'EXPENSE' ? getCategoryClass(tx.category) : 'badge-cat-otros'}" style="background-image: none; opacity: 1;">
                        <i data-lucide="${tx.type === 'EXPENSE' ? getCategoryIconName(tx.category) : 'arrow-down-circle'}" style="width: 18px; height: 18px; opacity: 0.9;"></i>
                    </div>
                    <!-- Textos Identidad -->
                    <div class="tx-identity-text">
                        <span class="tx-title">${tx.description} <span class="tx-date-inline">• ${dateStr}</span></span>
                        ${notesHtml}
                    </div>
                </div>

                <div class="tx-row-tags">
                    ${catBadge}
                    ${respBadge}
                    <span class="tx-inst-badge">${instText}</span>
                </div>

                <div class="tx-row-financials">
                    <span class="tx-amount ${tx.type === 'EXPENSE' ? 'expense' : 'payment'}">${amountSign}${formatMoney(instVal)}</span>
                    ${remainingSubtextHtml}
                </div>

                <div class="tx-row-status">
                    ${statusBtn}
                </div>

                <div class="tx-row-actions">
                    <button class="btn-table-action" onclick="editTransaction('${tx.id}')" title="Editar">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="btn-table-action delete" onclick="deleteTransaction('${tx.id}')" title="Eliminar">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

window.toggleTxStatus = function(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if (!tx) return;
    
    if ((tx.installments || 1) > 1 && (tx.responsible === 'Otros' || tx.responsible === 'Compartido')) {
        const paidInst = tx.friendPaidInstallments || 0;
        const currInst = tx.currentInstallment || 1;
        if (paidInst < currInst) {
            collectNextFriendInstallment(txId);
        } else {
            undoFriendInstallment(txId);
        }
        return;
    }

    if (tx.status === 'PENDING') {
        tx.status = 'PAID';
        tx.partialPaidAmount = tx.amount;
        if ((tx.installments || 1) > 1) tx.friendPaidInstallments = tx.installments;
    } else if (tx.status === 'PAID') {
        tx.status = 'PARTIAL';
        tx.partialPaidAmount = Math.round(tx.amount / 2);
        if ((tx.installments || 1) > 1) tx.friendPaidInstallments = Math.max(1, Math.round(tx.installments / 2));
    } else {
        tx.status = 'PENDING';
        tx.partialPaidAmount = 0;
        if ((tx.installments || 1) > 1) tx.friendPaidInstallments = 0;
    }
    
    saveData();
    showToast(`Estado cambiado a: ${tx.status === 'PAID' ? 'Pagado' : (tx.status === 'PARTIAL' ? 'Parcial' : 'Pendiente')}`, 'info');
};

window.editTransaction = function(txId) {
    const tx = appData.transactions.find(t => t.id === txId);
    if (!tx) return;
    
    setTxModalType(tx.type);
    document.getElementById('txId').value = tx.id;
    document.getElementById('txDescription').value = tx.description;
    document.getElementById('txAmount').value = tx.amount;
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txNotes').value = tx.notes || '';
    document.getElementById('txStatus').value = tx.status || 'PENDING';

    if (tx.type === 'EXPENSE') {
        document.getElementById('txCategory').value = tx.category || 'Otros';
        document.getElementById('txResponsible').value = tx.responsible || 'Yo';
        if (tx.friendName) document.getElementById('txFriendName').value = tx.friendName;
        if (tx.splitType) document.getElementById('txSplitType').value = tx.splitType;
        if (tx.customFriendAmount !== undefined && tx.customFriendAmount !== null) {
            document.getElementById('txCustomFriendAmount').value = tx.customFriendAmount;
        }
        document.getElementById('txResponsible').dispatchEvent(new Event('change'));
        if (tx.splitType) {
            document.getElementById('txSplitType').value = tx.splitType;
            document.getElementById('txSplitType').dispatchEvent(new Event('change'));
        }
        
        document.getElementById('txInstallments').value = tx.installments || 1;
        document.getElementById('txInstallments').dispatchEvent(new Event('change'));
        if ((tx.installments || 1) > 1) {
            document.getElementById('txCurrentInst').value = tx.currentInstallment || 1;
        }

        if (tx.status === 'PARTIAL') {
            document.getElementById('txStatus').dispatchEvent(new Event('change'));
            document.getElementById('txPartialAmount').value = tx.partialPaidAmount || 0;
        }
    }

    document.getElementById('modalTransactionTitle').innerText = 'Editar Movimiento';
    document.getElementById('modalTransaction').classList.add('open');
};

window.deleteTransaction = function(txId) {
    if (confirm('¿Estás seguro de eliminar esta operación?')) {
        appData.transactions = appData.transactions.filter(t => t.id !== txId);
        saveData();
        showToast('Operación eliminada', 'error');
    }
};

// 4. INSTALLMENTS TIMELINE
function renderInstallmentsView() {
    const grid = document.getElementById('installmentsGrid');
    const emptyState = document.getElementById('emptyInstallmentsState');
    if (!grid || !emptyState) return;

    const instExpenses = appData.transactions.filter(tx => tx.type === 'EXPENSE' && (tx.installments || 1) > 1);

    if (instExpenses.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = instExpenses.map(tx => {
        const totalInst = tx.installments;
        const currentInst = tx.currentInstallment || 1;
        const monthlyAmount = tx.amount / totalInst;
        const buyDate = new Date(tx.date + 'T00:00:00');
        const { cycleEnd: firstCycleEnd } = getCycleDates(buyDate);
        
        let timelineHtml = '<div class="msi-timeline">';
        for (let i = 1; i <= totalInst; i++) {
            let monthDate = new Date(firstCycleEnd.getFullYear(), firstCycleEnd.getMonth() + (i - 1), 15);
            let monthStr = monthDate.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
            monthStr = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
            
            let statusClass = ''; let subLabel = '';
            if (i < currentInst || (i === currentInst && tx.status === 'PAID')) {
                statusClass = 'paid'; subLabel = '✅ Facturada';
            } else if (i === currentInst) {
                statusClass = 'current'; subLabel = '⚡ En curso';
            } else {
                statusClass = 'future'; subLabel = `Cuota ${i}`;
            }

            timelineHtml += `
                <div class="msi-step ${statusClass}">
                    <div class="msi-step-indicator"></div>
                    <div class="msi-step-content">
                        <div>
                            <div class="msi-step-title">${monthStr}</div>
                            <div style="font-size: 10.5px; color: var(--text-muted); opacity: 0.8; margin-top: 1px;">${subLabel}</div>
                        </div>
                        <div class="msi-step-amount">${formatMoney(monthlyAmount)}</div>
                    </div>
                </div>
            `;
        }
        timelineHtml += '</div>';

        const progPercent = Math.min(100, Math.round(((currentInst - (tx.status === 'PAID' ? 0 : 1)) / totalInst) * 100));

        return `
            <div class="installment-plan-card glass-card">
                <div class="inst-header">
                    <div>
                        <h3 class="inst-title">${tx.description}</h3>
                        <span class="inst-date">Comprado el ${buyDate.toLocaleDateString('es-ES')} • ${tx.category}</span>
                    </div>
                    <span class="inst-badge">MSI</span>
                </div>
                
                <div class="inst-progress-info mt-2">
                    <span>Progreso: <strong>${progPercent}% saldado</strong></span>
                    <strong class="text-cyan">${formatMoney(tx.amount)} total</strong>
                </div>
                <div class="progress-bar-container progress-sm mt-1 mb-2">
                    <div class="progress-bar-fill green" style="width: ${progPercent}%;"></div>
                </div>

                <div class="inst-timeline">
                    <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; display: block;">Proyección Mensual</span>
                    ${timelineHtml}
                </div>
            </div>
        `;
    }).join('');
}

// 5. CHARTS (CHART.JS ULTRA-FAST 150MS RENDER)
function renderCharts() {
    if (typeof Chart === 'undefined') return;
    if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }
    const defaultFont = { family: "'Inter', sans-serif", size: 11 };
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font = defaultFont;

    const fastAnimation = {
        duration: 150,
        easing: 'easeOutQuad'
    };

    const { cycleStart, cycleEnd } = getCycleDates(new Date());

    // 1. Gasto por Categoría, 2. Responsable, 3. Cuotas vs Contado
    const catMap = {};
    const respMap = { 'Yo (Personal)': 0, 'Préstamos (Otros)': 0, 'Compartido': 0 };
    let contadoTotal = 0; let cuotasTotal = 0;

    appData.transactions.forEach(tx => {
        if (tx.type === 'EXPENSE') {
            const txDate = new Date(tx.date + 'T00:00:00');
            const inCycle = txDate >= cycleStart && txDate <= cycleEnd;
            const isInst = (tx.installments || 1) > 1;
            let instAmount = tx.amount;
            let isExpenseInCycle = inCycle;

            if (isInst) {
                instAmount = Math.round(tx.amount / tx.installments);
                const { cycleEnd: txCycleEnd } = getCycleDates(txDate);
                const monthDiff = (cycleEnd.getFullYear() - txCycleEnd.getFullYear()) * 12 + (cycleEnd.getMonth() - txCycleEnd.getMonth());
                isExpenseInCycle = (monthDiff >= 0 && monthDiff < tx.installments);
            }

            if (isExpenseInCycle) {
                // 1. Categoría
                const cat = tx.category || 'Otros';
                catMap[cat] = (catMap[cat] || 0) + instAmount;

                // 2. Responsable
                let yoShare = 0;
                let otrosShare = 0;
                let compartidoShare = 0;

                if (tx.responsible === 'Yo') {
                    yoShare = instAmount;
                } else if (tx.responsible === 'Otros') {
                    const ratio = tx.amount > 0 ? Math.min(1, Math.max(0, getFriendShare(tx) / tx.amount)) : 1;
                    otrosShare = Math.round(instAmount * ratio);
                    yoShare = instAmount - otrosShare;
                } else {
                    const ratio = tx.amount > 0 ? Math.min(1, Math.max(0, getFriendShare(tx) / tx.amount)) : 0.5;
                    compartidoShare = Math.round(instAmount * ratio);
                    yoShare = instAmount - compartidoShare;
                }

                respMap['Yo (Personal)'] += yoShare;
                respMap['Préstamos (Otros)'] += otrosShare;
                respMap['Compartido'] += compartidoShare;

                // 3. Cuotas vs Contado
                if (isInst) cuotasTotal += instAmount;
                else contadoTotal += instAmount;
            }
        }
    });

    const sortedAllCats = Object.entries(catMap).sort((a,b) => b[1] - a[1]);
    const catLabels = sortedAllCats.map(c => c[0]);
    const catData = sortedAllCats.map(c => c[1]);

    renderSingleChart('chartCategory', 'doughnut', {
        labels: catLabels.length ? catLabels : ['Sin gastos'],
        datasets: [{
            data: catData.length ? catData : [1],
            backgroundColor: ['#00f2fe', '#4facfe', '#10b981', '#f59e0b', '#ec0000', '#ec4899', '#6366f1', '#14b8a6', '#84cc16', '#a855f7', '#fb7185', '#cbd5e1'],
            borderWidth: 1, borderColor: '#101828'
        }]
    }, { responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.label + ': ' + formatMoney(ctx.raw); } } }, legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } });

    renderSingleChart('chartResponsible', 'pie', {
        labels: Object.keys(respMap),
        datasets: [{
            data: Object.values(respMap).some(v => v > 0) ? Object.values(respMap) : [1, 0, 0],
            backgroundColor: ['#00f2fe', '#a855f7', '#f59e0b'],
            borderWidth: 1, borderColor: '#101828'
        }]
    }, { responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { color: '#fff', font: { weight: 'bold', size: 10 }, textShadowBlur: 4, textShadowColor: 'rgba(0,0,0,0.8)', formatter: function(val) { return val > 1 ? formatMoney(val) : ''; } }, legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } });

    renderSingleChart('chartInstallmentsVsSingle', 'bar', {
        labels: ['Contado (1 cuota)', 'A Cuotas (MSI)'],
        datasets: [{
            label: 'Monto Total',
            data: (contadoTotal > 0 || cuotasTotal > 0) ? [contadoTotal, cuotasTotal] : [0, 0],
            backgroundColor: ['#10b981', '#00f2fe'],
            borderRadius: 6
        }]
    }, { responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { display: false }, legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } });

    // 4. Top Deudores (NO TOCADO)
    const debtors = getDebtorsSummary().slice(0, 5);
    renderSingleChart('chartTopDebtors', 'bar', {
        labels: debtors.length ? debtors.map(d => d.name) : ['Nadie te debe'],
        datasets: [{
            label: 'Deuda Pendiente',
            data: debtors.length ? debtors.map(d => d.totalPending) : [0],
            backgroundColor: '#a855f7',
            borderRadius: 6
        }]
    }, { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { anchor: 'end', align: 'end', clamp: true, color: '#fff', font: { weight: 'bold', size: 11 }, formatter: function(val) { return val > 0 ? formatMoney(val) : ''; } }, tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + formatMoney(ctx.raw); } } }, legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { grid: { display: false } } } });

    // 5. Top 5 Categorías Mayor Consumo (reusa catMap)
    const sortedCats = Object.entries(catMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
    renderSingleChart('chartTopCategories', 'bar', {
        labels: sortedCats.length ? sortedCats.map(c => c[0]) : ['Sin datos'],
        datasets: [{
            label: 'Consumo ($)',
            data: sortedCats.length ? sortedCats.map(c => c[1]) : [0],
            backgroundColor: ['#00f2fe', '#4facfe', '#10b981', '#f59e0b', '#ec0000'],
            borderRadius: 6
        }]
    }, { responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { display: false }, legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } });

    // 6. Tendencia 6 Ciclos
    const monthsMap = {};
    const pastCycles = [];
    let currentRefDate = new Date();
    for (let i = 0; i < 6; i++) {
        const cycle = getCycleDates(currentRefDate);
        pastCycles.push(cycle);
        currentRefDate = new Date(cycle.cycleStart);
        currentRefDate.setDate(currentRefDate.getDate() - 5);
    }
    pastCycles.reverse();
    
    pastCycles.forEach(cycle => {
        let key = cycle.cycleEnd.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
        monthsMap[key] = 0;
        appData.transactions.forEach(tx => {
            if (tx.type === 'EXPENSE') {
                const txDate = new Date(tx.date + 'T00:00:00');
                const isInst = (tx.installments || 1) > 1;
                let instAmount = tx.amount;
                let isExpenseInCycle = (txDate >= cycle.cycleStart && txDate <= cycle.cycleEnd);
                
                if (isInst) {
                    instAmount = Math.round(tx.amount / tx.installments);
                    const { cycleEnd: txCycleEnd } = getCycleDates(txDate);
                    const monthDiff = (cycle.cycleEnd.getFullYear() - txCycleEnd.getFullYear()) * 12 + (cycle.cycleEnd.getMonth() - txCycleEnd.getMonth());
                    isExpenseInCycle = (monthDiff >= 0 && monthDiff < tx.installments);
                }
                
                if (isExpenseInCycle) {
                    monthsMap[key] += instAmount;
                }
            }
        });
    });

    renderSingleChart('chartTrend', 'line', {
        labels: Object.keys(monthsMap),
        datasets: [{
            label: 'Gasto Facturado',
            data: Object.values(monthsMap),
            borderColor: '#00f2fe',
            backgroundColor: 'rgba(0, 242, 254, 0.1)',
            fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#fff'
        }]
    }, { responsive: true, maintainAspectRatio: false, animation: fastAnimation, plugins: { datalabels: { display: false }, legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } });
}

function renderSingleChart(canvasId, type, data, options) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    const mergedOptions = {
        ...options,
        devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
    };
    chartInstances[canvasId] = new Chart(canvas, { type, data, options: mergedOptions });
}

// --- IMPORT & EXPORT (JSON / CSV) ---
function exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `santander_worldmember_respaldo_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    showToast('Respaldo JSON descargado con éxito', 'success');
}

function exportCSV() {
    if (appData.transactions.length === 0) {
        showToast('No hay transacciones para exportar', 'error');
        return;
    }

    const headers = ['ID', 'Tipo', 'Fecha', 'Descripción', 'Categoría', 'Responsable', 'Persona', 'Monto', 'Cuotas', 'Cuota Actual', 'Estado', 'Monto Abonado', 'Cuotas Pagadas', 'Notas'];
    const rows = appData.transactions.map(t => [
        `"${t.id}"`, `"${t.type}"`, `"${t.date}"`, `"${(t.description||'').replace(/"/g, '""')}"`, `"${t.category||''}"`, `"${t.responsible||''}"`, `"${t.friendName||''}"`,
        t.amount, t.installments||1, t.currentInstallment||1, `"${t.status||'PENDING'}"`, t.partialPaidAmount||0, t.friendPaidInstallments||0, `"${(t.notes||'').replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", encodeURI(csvContent));
    dlAnchor.setAttribute("download", `santander_worldmember_tabla_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    showToast('Tabla CSV exportada para Excel/Sheets', 'success');
}

function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const content = event.target.result;
            if (file.name.endsWith('.json')) {
                const parsed = JSON.parse(content);
                if (parsed && Array.isArray(parsed.transactions)) {
                    appData = { 
                        ...appData, 
                        ...parsed, 
                        settings: { ...appData.settings, ...(parsed.settings || parsed.config || {}) } 
                    };
                    saveData();
                    loadFriendsList();
                    initUI();
                    showToast('Respaldo JSON importado correctamente', 'success');
                } else {
                    throw new Error('Formato JSON inválido');
                }
            } else if (file.name.endsWith('.csv')) {
                const lines = content.split('\n');
                if (lines.length > 1) {
                    let importedCount = 0;
                    for (let i = 1; i < lines.length; i++) {
                        const row = lines[i].trim();
                        if (!row) continue;
                        const cols = row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
                        if (cols && cols.length >= 8) {
                            const clean = cols.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
                            appData.transactions.push({
                                id: clean[0] || 'tx_' + Date.now() + '_' + i,
                                type: clean[1] || 'EXPENSE',
                                date: clean[2] || new Date().toISOString().split('T')[0],
                                description: clean[3] || 'Importado CSV',
                                category: clean[4] || 'Otros',
                                responsible: clean[5] || 'Yo',
                                friendName: clean[6] || '',
                                amount: parseFloat(clean[7]) || 0,
                                installments: parseInt(clean[8]) || 1,
                                currentInstallment: parseInt(clean[9]) || 1,
                                status: clean[10] || 'PENDING',
                                partialPaidAmount: parseFloat(clean[11]) || 0,
                                friendPaidInstallments: parseInt(clean[12]) || 0,
                                notes: clean[13] || ''
                            });
                            importedCount++;
                        }
                    }
                    saveData();
                    loadFriendsList();
                    showToast(`Se importaron ${importedCount} filas desde CSV`, 'success');
                }
            }
            document.getElementById('modalExport')?.classList.remove('open');
        } catch (err) {
            console.error(err);
            showToast('Error al importar el archivo: ' + err.message, 'error');
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

// --- TOAST NOTIFICATIONS ---
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle-2';
    else if (type === 'error') icon = 'alert-circle';

    toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
