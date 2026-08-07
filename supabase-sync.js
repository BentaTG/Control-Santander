// ==========================================================================
// SUPABASE SYNC LOGIC
// ==========================================================================

const SUPABASE_URL = 'https://zgcvzubkhshibapvrvma.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnY3Z6dWJraHNoaWJhcHZydm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MTA1OTksImV4cCI6MjEwMTM4NjU5OX0.u7Fb5yz5rki47GSlCshPL0DGJr6dumYaKvccFfjO8BU';

let supabaseClient;
let currentUser = null;

// Referencias a los elementos del modal
const authModal = document.getElementById('authModal');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authErrorMsg = document.getElementById('authErrorMsg');
const btnLogin = document.getElementById('btnLogin');
const btnRegister = document.getElementById('btnRegister');
const btnLogout = document.getElementById('btnLogout');
const syncOverlay = document.getElementById('syncOverlay');

function showSyncOverlay(text = 'Sincronizando...') {
    if(!syncOverlay) return;
    syncOverlay.querySelector('p').innerText = text;
    syncOverlay.classList.remove('hidden');
}

function hideSyncOverlay() {
    if(!syncOverlay) return;
    syncOverlay.classList.add('hidden');
}

function showAuthError(msg) {
    if(authErrorMsg) authErrorMsg.innerText = msg;
}

// Traductor de Errores de Supabase
function translateError(error) {
    if (!error) return "Error desconocido";
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (msg.includes('user already registered')) return 'Este correo ya está registrado.';
    if (msg.includes('password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
    if (msg.includes('email link')) return 'Revisa tu correo para verificar la cuenta.';
    if (msg.includes('fetch')) return 'Error de conexión. Revisa tu internet.';
    return error.message;
}

// Inicialización
async function initSupabase() {
    if (!window.supabase) {
        console.error("Supabase CDN no cargó. Asegúrate de tener conexión a internet.");
        return;
    }
    
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session) {
            currentUser = session.user;
            authModal.classList.remove('show');
            await initialSync();
            setupRealtimeSubscription();
        } else {
            console.log("No hay sesión. Mostrando modal...");
            authModal.classList.add('show');
        }

        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN') {
                currentUser = session.user;
                authModal.classList.remove('show');
                await initialSync();
                setupRealtimeSubscription();
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                authModal.classList.add('show');
                supabaseClient.removeAllChannels();
            }
        });
    } catch (e) {
        console.error("Error en initSupabase:", e);
    }
}

// Event Listeners for Auth
if (btnLogin) {
    btnLogin.addEventListener('click', async (e) => {
        e.preventDefault();
        showAuthError('');
        const email = authEmail.value;
        const password = authPassword.value;
        if (!email || !password) { showAuthError('Ingresa correo y contraseña'); return; }
        
        btnLogin.disabled = true;
        btnLogin.innerText = 'Cargando...';
        
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        
        if (error) {
            showAuthError(translateError(error));
            btnLogin.disabled = false;
            btnLogin.innerText = 'Iniciar Sesión';
        }
    });
}

if (btnRegister) {
    btnRegister.addEventListener('click', async (e) => {
        e.preventDefault();
        showAuthError('');
        const email = authEmail.value;
        const password = authPassword.value;
        if (!email || !password) { showAuthError('Ingresa correo y contraseña'); return; }
        
        btnRegister.disabled = true;
        btnRegister.innerText = 'Creando...';
        
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        
        if (error) {
            showAuthError(translateError(error));
            btnRegister.disabled = false;
            btnRegister.innerText = 'Registrarse';
        } else {
            showAuthError('Cuenta creada. Ya puedes iniciar sesión.');
            btnRegister.disabled = false;
            btnRegister.innerText = 'Registrarse';
        }
    });
}

if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        // Clear local storage on logout for security
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(FRIENDS_STORAGE_KEY);
        location.reload();
    });
}

// --- LÓGICA DE SINCRONIZACIÓN ---

async function initialSync(silent = false) {
    if (!silent) showSyncOverlay('Descargando datos...');
    try {
        // 1. Obtener settings
        const { data: settingsData, error: settingsError } = await supabaseClient
            .from('user_settings')
            .select('*')
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (settingsError) {
            console.error('Error fetching settings:', settingsError);
        }

        // 2. Obtener transacciones
        const { data: txData, error: txError } = await supabaseClient
            .from('transactions')
            .select('*')
            .eq('user_id', currentUser.id);

        if (txError) {
            console.error('Error fetching tx:', txError);
        }

        // 3. Obtener amigos
        const { data: friendsData, error: friendsError } = await supabaseClient
            .from('friends')
            .select('*')
            .eq('user_id', currentUser.id);

        // Si tenemos datos en Supabase, los usamos (la nube manda)
        if (settingsData || (txData && txData.length > 0)) {
            const cloudAppData = {
                settings: settingsData ? {
                    cardName: settingsData.card_name,
                    last4: settingsData.last4,
                    holderName: settingsData.holder_name,
                    creditLimit: settingsData.credit_limit,
                    initialBalance: settingsData.initial_balance,
                    closingDay: settingsData.closing_day,
                    dueDay: settingsData.due_day,
                    currency: settingsData.currency
                } : appData.settings,
                transactions: txData ? txData.map(tx => ({
                    id: tx.id,
                    type: tx.type,
                    date: tx.date,
                    description: tx.description,
                    category: tx.category,
                    responsible: tx.responsible,
                    friendName: tx.friend_name,
                    amount: tx.amount,
                    installments: tx.installments,
                    currentInstallment: tx.current_installment,
                    status: tx.status,
                    partialPaidAmount: tx.partial_paid_amount,
                    friendPaidInstallments: tx.friend_paid_installments,
                    notes: tx.notes
                })) : []
            };

            appData = cloudAppData;
            
            if (friendsData && friendsData.length > 0) {
                savedFriends = friendsData.map(f => f.name);
            }
            
            // Guardar en local como caché
            localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
            localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(savedFriends));
            
            renderAll();
            updateFriendsDatalist();
        } else {
            // Si Supabase está vacío pero tenemos datos locales (ej. es el PC principal en la primera vez)
            console.log('Supabase vacío, subiendo datos locales...');
            await pushLocalToSupabase();
        }

    } catch (e) {
        console.error('Sync error:', e);
    }
    if (!silent) hideSyncOverlay();
}

async function pushLocalToSupabase(silent = false) {
    if (!currentUser) return;
    if (!silent) showSyncOverlay('Subiendo respaldo...');
    
    try {
        // Subir Settings
        const dbSettings = {
            user_id: currentUser.id,
            card_name: appData.settings?.cardName || 'SANTANDER WORLDMEMBER',
            last4: appData.settings?.last4 || '4532',
            holder_name: appData.settings?.holderName || 'BENJAMÍN TRALMA GUTIÉRREZ',
            credit_limit: appData.settings?.creditLimit || 1000000,
            initial_balance: appData.settings?.initialBalance || 0,
            closing_day: appData.settings?.closingDay || 25,
            due_day: appData.settings?.dueDay || 5,
            currency: appData.settings?.currency || 'CLP',
            updated_at: new Date().toISOString()
        };

        await supabaseClient.from('user_settings').upsert(dbSettings, { onConflict: 'user_id' });

        // Subir Transacciones (Batch)
        if (appData.transactions.length > 0) {
            const dbTx = appData.transactions.map(tx => ({
                id: tx.id,
                user_id: currentUser.id,
                type: tx.type || 'EXPENSE',
                date: tx.date || new Date().toISOString().split('T')[0],
                description: tx.description || 'Sin descripción',
                category: tx.category || 'Otros',
                responsible: tx.responsible || 'Yo',
                friend_name: tx.friendName || '',
                amount: tx.amount || 0,
                installments: tx.installments || 1,
                current_installment: tx.currentInstallment || 1,
                status: tx.status || 'PENDING',
                partial_paid_amount: tx.partialPaidAmount || 0,
                friend_paid_installments: tx.friendPaidInstallments || 0,
                notes: tx.notes || '',
                updated_at: new Date().toISOString()
            }));
            
            await supabaseClient.from('transactions').upsert(dbTx);
        }

        // Subir Amigos
        if (savedFriends.length > 0) {
            const dbFriends = savedFriends.map(f => ({
                user_id: currentUser.id,
                name: f
            }));
            await supabaseClient.from('friends').upsert(dbFriends, { onConflict: 'user_id,name' });
        }

    } catch(e) {
        console.error("Error pushing data:", e);
    }
    if (!silent) hideSyncOverlay();
}

function setupRealtimeSubscription() {
    supabaseClient.channel('custom-all-channel')
    .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        async (payload) => {
            console.log('Realtime change received!', payload);
            await initialSync(true); // Sincronización silenciosa en realtime
        }
    )
    .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_settings' },
        async (payload) => {
            await initialSync(true); // Sincronización silenciosa en realtime
        }
    )
    .subscribe();
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        initSupabase();
    }, 500);
});

window.syncToSupabase = async function(silent = false) {
    if (!currentUser) return;
    if (!silent) showSyncOverlay('Guardando en la nube...');
    await pushLocalToSupabase(silent);
};
