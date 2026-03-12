/* ═══════════════════════════════════════════════════════
   Devis CECB — Authentication System
   Adapted from CECB Plus auth.js
   Local management with SHA-256 hashed passwords
   Admin: info@etaconsult.ch
   ═══════════════════════════════════════════════════════ */

const AUTH_STORAGE_KEY = 'cecb-auth-users';
const AUTH_SESSION_KEY = 'cecb-auth-session';
const ADMIN_EMAIL = 'info@etaconsult.ch';

/* ─── Crypto ──────────────────────────────────────────── */

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── User Store ──────────────────────────────────────── */

function getUsers() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveUsers(users) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(users));
}

async function initAdmin() {
    const users = getUsers();
    const admin = users.find(u => u.email === ADMIN_EMAIL);
    if (!admin) {
        users.push({ email: ADMIN_EMAIL, passwordHash: '', isAdmin: true, firstName: 'Gerard', lastName: 'Merminod', name: 'Gerard Merminod' });
        saveUsers(users);
    } else if (!admin.firstName) {
        var parts = (admin.name || 'Gerard Merminod').split(' ');
        admin.firstName = parts[0] || '';
        admin.lastName = parts.slice(1).join(' ') || '';
        saveUsers(users);
    }
}

/* ─── Session ─────────────────────────────────────────── */

function getSession() {
    try {
        var s = sessionStorage.getItem(AUTH_SESSION_KEY);
        if (!s) s = localStorage.getItem(AUTH_SESSION_KEY);
        return s ? JSON.parse(s) : null;
    } catch (e) {
        return null;
    }
}

function setSession(user, persistent) {
    var data = JSON.stringify({ email: user.email, isAdmin: user.isAdmin, name: (user.firstName || '') + ' ' + (user.lastName || '') });
    sessionStorage.setItem(AUTH_SESSION_KEY, data);
    if (persistent) {
        localStorage.setItem(AUTH_SESSION_KEY, data);
    }
}

function clearSession() {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
}

function isLoggedIn() {
    return getSession() !== null;
}

function isAdmin() {
    const s = getSession();
    return s && s.isAdmin;
}

/* ─── Auth Actions ────────────────────────────────────── */

async function login(email, password, persistent) {
    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return { ok: false, msg: 'Compte introuvable' };

    if (user.isAdmin && !user.passwordHash) {
        return { ok: false, msg: 'first-setup', user: user };
    }

    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) return { ok: false, msg: 'Mot de passe incorrect' };

    setSession(user, persistent);
    return { ok: true };
}

async function setPassword(email, newPassword) {
    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return false;
    user.passwordHash = await hashPassword(newPassword);
    saveUsers(users);
    return true;
}

async function addUser(email, password, firstName, lastName) {
    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return { ok: false, msg: 'Cet email existe deja' };
    }
    const hash = await hashPassword(password);
    users.push({ email: email.toLowerCase(), passwordHash: hash, plainPassword: password, isAdmin: false, firstName: firstName || '', lastName: lastName || '', name: ((firstName || '') + ' ' + (lastName || '')).trim() || email });
    saveUsers(users);
    return { ok: true };
}

function removeUser(email) {
    if (email.toLowerCase() === ADMIN_EMAIL) return false;
    let users = getUsers();
    users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
    saveUsers(users);
    return true;
}

/* ─── UI ──────────────────────────────────────────────── */

function injectAuthStyles() {
    if (document.getElementById('auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-styles';
    style.textContent = `
.auth-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center}
.auth-box{background:#fff;border-radius:12px;padding:32px;width:380px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.2)}
.auth-box h2{color:#0F172A;margin:0 0 20px;font-size:20px;text-align:center}
.auth-box .auth-field{margin-bottom:14px}
.auth-box label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px}
.auth-box input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px}
.auth-box input:focus{outline:none;border-color:#10B981}
.auth-box .auth-btn{width:100%;padding:12px;background:#10B981;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s;margin-top:8px}
.auth-box .auth-btn:hover{background:#059669}
.auth-box .auth-error{color:#c62828;font-size:13px;margin-top:8px;text-align:center;display:none}
.auth-box .auth-error.visible{display:block}
.auth-user-bar{background:#0F172A;color:#fff;display:flex;align-items:center;padding:0 24px;font-size:13px;gap:12px;height:32px}
.auth-user-bar span{opacity:.8}
.auth-user-bar .auth-logout{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;font-size:13px;font-weight:600;padding:4px 12px;border-radius:4px;transition:all .2s}
.auth-user-bar .auth-logout:hover{color:#fff;background:rgba(255,255,255,.15)}
.auth-user-bar .auth-admin-link{background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;font-size:13px;font-weight:600;padding:4px 12px;border-radius:4px;transition:all .2s}
.auth-user-bar .auth-admin-link:hover{color:#fff;background:rgba(255,255,255,.15)}
.admin-panel{background:#fff;border-radius:10px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.admin-panel h3{color:#059669;margin:0 0 16px;font-size:16px}
.admin-panel table{width:100%;border-collapse:collapse;font-size:13px}
.admin-panel th{text-align:left;padding:8px;border-bottom:2px solid #10B981;font-weight:600;color:#333}
.admin-panel td{padding:8px;border-bottom:1px solid #eee}
.admin-panel .btn-del{padding:4px 12px;background:#fce4ec;color:#c62828;border:1px solid #f8bbd0;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600}
.admin-panel .btn-del:hover{background:#f8bbd0}
.admin-add-form{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:flex-end}
.admin-add-form .field{display:flex;flex-direction:column;gap:4px}
.admin-add-form .field label{font-size:11px;font-weight:600;color:#666}
.admin-add-form .field input{padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px}
.admin-add-form .field input:focus{outline:none;border-color:#10B981}
.admin-add-form button{padding:8px 16px;background:#10B981;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;align-self:flex-end}
.admin-add-form button:hover{background:#059669}
`;
    document.head.appendChild(style);
}

function showLoginModal() {
    injectAuthStyles();
    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.id = 'authOverlay';
    overlay.innerHTML = `
        <div class="auth-box">
            <h2>Devis CECB — Connexion</h2>
            <div id="authLoginForm">
                <div class="auth-field">
                    <label>Email</label>
                    <input type="email" id="authEmail" placeholder="votre@email.ch" autocomplete="email">
                </div>
                <div class="auth-field">
                    <label>Mot de passe</label>
                    <input type="password" id="authPassword" placeholder="Mot de passe" autocomplete="current-password">
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin:8px 0 12px">
                    <input type="checkbox" id="authRemember" style="margin:0;width:16px;height:16px;accent-color:#10B981">
                    <label for="authRemember" style="font-size:13px;color:#64748B;cursor:pointer;user-select:none">Rester connecte</label>
                </div>
                <button class="auth-btn" id="authLoginBtn">Se connecter</button>
                <div class="auth-error" id="authError"></div>
            </div>
            <div id="authSetupForm" style="display:none">
                <p style="font-size:13px;color:#666;margin-bottom:12px;text-align:center">Premiere connexion admin — definissez votre mot de passe</p>
                <div class="auth-field">
                    <label>Nouveau mot de passe</label>
                    <input type="password" id="authNewPw" placeholder="Nouveau mot de passe">
                </div>
                <div class="auth-field">
                    <label>Confirmer</label>
                    <input type="password" id="authConfirmPw" placeholder="Confirmer le mot de passe">
                </div>
                <button class="auth-btn" id="authSetupBtn">Definir le mot de passe</button>
                <div class="auth-error" id="authSetupError"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => document.getElementById('authEmail').focus(), 100);

    document.getElementById('authLoginBtn').addEventListener('click', handleLogin);
    document.getElementById('authPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('authEmail').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') document.getElementById('authPassword').focus();
    });

    document.getElementById('authSetupBtn').addEventListener('click', handleSetup);
    document.getElementById('authConfirmPw').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleSetup();
    });
}

let setupEmail = '';

async function handleLogin() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');

    if (!email || !password) {
        errorEl.textContent = 'Veuillez remplir tous les champs';
        errorEl.classList.add('visible');
        return;
    }

    const persistent = document.getElementById('authRemember').checked;
    const result = await login(email, password, persistent);
    if (result.ok) {
        document.getElementById('authOverlay').remove();
        onAuthSuccess();
    } else if (result.msg === 'first-setup') {
        setupEmail = email;
        document.getElementById('authLoginForm').style.display = 'none';
        document.getElementById('authSetupForm').style.display = 'block';
        document.getElementById('authNewPw').focus();
    } else {
        errorEl.textContent = result.msg;
        errorEl.classList.add('visible');
    }
}

async function handleSetup() {
    const pw = document.getElementById('authNewPw').value;
    const confirm = document.getElementById('authConfirmPw').value;
    const errorEl = document.getElementById('authSetupError');

    if (pw.length < 4) {
        errorEl.textContent = 'Le mot de passe doit contenir au moins 4 caracteres';
        errorEl.classList.add('visible');
        return;
    }
    if (pw !== confirm) {
        errorEl.textContent = 'Les mots de passe ne correspondent pas';
        errorEl.classList.add('visible');
        return;
    }

    await setPassword(setupEmail, pw);
    const loginResult = await login(setupEmail, pw);
    if (loginResult.ok) {
        document.getElementById('authOverlay').remove();
        onAuthSuccess();
    }
}

function showUserBar() {
    injectAuthStyles();
    const session = getSession();
    if (!session) return;

    const existing = document.getElementById('authUserBar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.className = 'auth-user-bar';
    bar.id = 'authUserBar';
    bar.innerHTML = '<span>Connecte : ' + escapeAuthHtml(session.email) + '</span>';

    if (session.isAdmin) {
        const adminBtn = document.createElement('button');
        adminBtn.className = 'auth-admin-link';
        adminBtn.textContent = 'Gestion des acces';
        adminBtn.addEventListener('click', toggleAdminPanel);
        bar.appendChild(adminBtn);
    }

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'auth-logout';
    logoutBtn.textContent = 'Deconnexion';
    logoutBtn.addEventListener('click', function() {
        clearSession();
        location.reload();
    });
    bar.appendChild(logoutBtn);

    const nav = document.querySelector('.main-nav');
    if (nav) {
        nav.parentNode.insertBefore(bar, nav.nextSibling);
    } else {
        document.body.prepend(bar);
    }
}

function toggleAdminPanel() {
    const existing = document.getElementById('adminPanel');
    if (existing) {
        existing.remove();
        return;
    }
    renderAdminPanel();
}

function renderAdminPanel() {
    const existing = document.getElementById('adminPanel');
    if (existing) existing.remove();

    const users = getUsers();
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.id = 'adminPanel';

    let html = '<h3>Gestion des acces</h3>';
    html += '<table><thead><tr><th>Prenom</th><th>Nom</th><th>Email</th><th>Mot de passe</th><th>Role</th><th></th></tr></thead><tbody>';
    users.forEach(u => {
        var fn = u.firstName || (u.name ? u.name.split(' ')[0] : '');
        var ln = u.lastName || (u.name ? u.name.split(' ').slice(1).join(' ') : '');
        html += '<tr><td>' + escapeAuthHtml(fn) + '</td><td>' + escapeAuthHtml(ln) + '</td><td>' + escapeAuthHtml(u.email) + '</td><td style="font-family:monospace;font-size:12px;color:#666">' + (u.plainPassword ? escapeAuthHtml(u.plainPassword) : '<em style="color:#aaa">—</em>') + '</td><td>' + (u.isAdmin ? 'Admin' : 'Utilisateur') + '</td>';
        if (!u.isAdmin) {
            html += '<td><button class="btn-del" data-email="' + escapeAuthHtml(u.email) + '">Supprimer</button></td>';
        } else {
            html += '<td></td>';
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<div class="admin-add-form" id="adminAddForm">';
    html += '<div class="field"><label>Prenom</label><input type="text" id="adminNewFirstName" placeholder="Prenom"></div>';
    html += '<div class="field"><label>Nom</label><input type="text" id="adminNewLastName" placeholder="Nom"></div>';
    html += '<div class="field"><label>Email</label><input type="email" id="adminNewEmail" placeholder="email@example.ch"></div>';
    html += '<div class="field"><label>Mot de passe</label><input type="text" id="adminNewPw" placeholder="Mot de passe"></div>';
    html += '<button id="adminAddBtn">Ajouter</button>';
    html += '</div>';
    html += '<div class="auth-error" id="adminError" style="text-align:left;margin-top:8px"></div>';

    panel.innerHTML = html;

    const container = document.querySelector('.container');
    if (container) {
        container.prepend(panel);
    }

    panel.querySelectorAll('.btn-del').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const email = this.dataset.email;
            if (confirm('Supprimer l\'acces pour ' + email + ' ?')) {
                removeUser(email);
                renderAdminPanel();
            }
        });
    });

    document.getElementById('adminAddBtn').addEventListener('click', async function() {
        const firstName = document.getElementById('adminNewFirstName').value.trim();
        const lastName = document.getElementById('adminNewLastName').value.trim();
        const email = document.getElementById('adminNewEmail').value.trim();
        const pw = document.getElementById('adminNewPw').value;
        const errorEl = document.getElementById('adminError');

        if (!email || !pw) {
            errorEl.textContent = 'Email et mot de passe requis';
            errorEl.classList.add('visible');
            return;
        }
        if (pw.length < 4) {
            errorEl.textContent = 'Le mot de passe doit contenir au moins 4 caracteres';
            errorEl.classList.add('visible');
            return;
        }

        const result = await addUser(email, pw, firstName, lastName);
        if (result.ok) {
            renderAdminPanel();
        } else {
            errorEl.textContent = result.msg;
            errorEl.classList.add('visible');
        }
    });
}

function escapeAuthHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ─── Auth Gate ────────────────────────────────────────── */

function onAuthSuccess() {
    showUserBar();
    document.querySelectorAll('.container').forEach(function(el) {
        el.style.display = '';
    });
    // Show/hide admin-only nav items
    document.querySelectorAll('.nav-admin-only').forEach(function(el) {
        if (isAdmin()) {
            el.classList.remove('nav-admin-only');
            el.classList.add('nav-admin-visible');
        }
    });
}

async function checkAuth() {
    await initAdmin();
    injectAuthStyles();

    if (isLoggedIn()) {
        onAuthSuccess();
    } else {
        document.querySelectorAll('.container').forEach(function(el) {
            el.style.display = 'none';
        });
        showLoginModal();
    }
}

document.addEventListener('DOMContentLoaded', checkAuth);
