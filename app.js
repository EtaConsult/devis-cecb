/* ═══════════════════════════════════════════════════════
   Devis CECB — Application Logic
   Swisstopo autocomplete · RegBL · Pricing · Bexio API
   ═══════════════════════════════════════════════════════ */

// ==========================================
// CONFIGURATION & TARIFS
// ==========================================
const TARIFS = {
    base_price: 500,
    km_factor_proche: 0.9,
    km_factor_loin: 0.7,
    km_seuil: 25,
    surface_factor_petit: 0.7,
    surface_factor_grand: 0.6,
    surface_seuil: 750,
    plus_factor_petit: 3.69,
    plus_factor_moyen: 2.29,
    plus_factor_grand: 1.79,
    plus_seuil_petit: 160,
    plus_seuil_grand: 750,
    plus_price_max: 1989,
    frais_emission_cecb: 80,
    frais_emission_cecb_plus: 110,
    frais_maj_transfert_cecb: 90,
    frais_maj_cecb: 30,
    demande_subvention_cecb_plus: 155,
    conseil_restitution_cecb_plus: 155,
    prix_conseil_incitatif: 0,
    forfait_normal: 0,
    forfait_express: 155,
    forfait_urgent: 310,
    pct_acompte: 30
};

const BEXIO_IDS = {
    user_id: 1,
    mwst_type: 0,
    currency_id: 1,
    language_id: 2,  // 1=DE, 2=FR, 3=IT, 4=EN
    article_cecb: 1,            // Etablissement d'un certificat CECB
    article_cecb_plus: 3,       // Etablissement d'un certificat CECB Plus, en sus
    article_frais_emission: 10, // Frais d'emission du rapport CECB
    article_forfait_execution: 12, // Prise de mesure (pas de plans)
    tax_id: 16,                 // UN77 - Revenue 7.70%
    unit_id: 3                   // 3 = forfait (ensemble)
};

const ETA_CONSULT_COORDS = { lat: 46.4571, lon: 6.3375 };

// Toutes les requetes Bexio passent par le proxy local (server.py)
function getBexioUrl(endpoint) {
    return '/api/bexio' + endpoint;
}

// State
let buildingData = null;
let searchTimeout = null;
let currentView = 'form';
let tempTarifs = null; // Tarifs temporaires (one-shot, en memoire uniquement)
let cachedDistanceKm = 0; // Distance calculee via Google Maps
const TARIF_HISTORY_KEY = 'devis_tarifs_history';

// ==========================================
// DRAFTS (BROUILLONS)
// ==========================================
const DRAFTS_KEY = 'devis-drafts';

function getDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || []; }
    catch (e) { return []; }
}

function saveDraft() {
    const form = document.getElementById('devisForm');
    const fd = new FormData(form);
    const data = {};
    fd.forEach((v, k) => { data[k] = v; });

    // Generer un label lisible
    const client = data.type_contact === 'Societe'
        ? (data.nom_entreprise || 'Societe')
        : ((data.prenom || '') + ' ' + (data.nom_famille || '')).trim() || 'Sans nom';
    const adresse = data.rue_facturation || data.rue_batiment || '';

    const drafts = getDrafts();
    const draft = {
        id: Date.now(),
        date: new Date().toISOString(),
        label: client + (adresse ? ' — ' + adresse : ''),
        data
    };

    drafts.unshift(draft);
    if (drafts.length > 20) drafts.pop();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    renderDraftsList();
    addLog('Brouillon sauvegarde: ' + draft.label, 'success');
}

function loadDraft(id) {
    const drafts = getDrafts();
    const draft = drafts.find(d => d.id === id);
    if (!draft || !draft.data) return;

    const fd = draft.data;
    Object.keys(fd).forEach(key => {
        const el = document.getElementById(key);
        if (el) {
            el.value = fd[key];
            if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change'));
        }
    });

    // Re-check adresse identique
    if (fd.adresse_identique === 'on') {
        document.getElementById('adresse_identique').checked = true;
        document.getElementById('adresse_identique').dispatchEvent(new Event('change'));
    }

    addLog('Brouillon charge: ' + draft.label, 'success');
    updatePricePreview();
}

function deleteDraft(id) {
    let drafts = getDrafts();
    drafts = drafts.filter(d => d.id !== id);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    renderDraftsList();
    addLog('Brouillon supprime', 'info');
}

function renderDraftsList() {
    const el = document.getElementById('draftsList');
    if (!el) return;

    const drafts = getDrafts();
    if (drafts.length === 0) {
        el.innerHTML = '<div style="color:#94A3B8;font-size:13px">Aucun brouillon</div>';
        return;
    }

    let html = '';
    drafts.forEach(d => {
        const date = new Date(d.date).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        html += `<div class="draft-item">`;
        html += `<div class="draft-info" onclick="loadDraft(${d.id})" style="cursor:pointer;flex:1">`;
        html += `<span class="draft-label">${escapeHtml(d.label)}</span>`;
        html += `<span class="draft-date">${date}</span>`;
        html += `</div>`;
        html += `<button class="btn-del" onclick="deleteDraft(${d.id})" title="Supprimer">✕</button>`;
        html += `</div>`;
    });
    el.innerHTML = html;
}

// ==========================================
// VIEW NAVIGATION
// ==========================================
function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll('.container').forEach(el => el.style.display = 'none');
    const target = document.getElementById('view-' + viewName);
    if (target) target.style.display = '';

    document.querySelectorAll('.main-nav a').forEach(a => {
        a.classList.toggle('active', a.dataset.view === viewName);
    });

    if (viewName === 'history') renderHistory();
    if (viewName === 'texts') renderTextsEditor();
}

// ==========================================
// SUBMISSION HISTORY
// ==========================================
const HISTORY_KEY = 'devis-submissions';

function getSubmissions() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (e) { return []; }
}

function saveSubmission(submission) {
    const subs = getSubmissions();
    subs.unshift(submission);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(subs));
}

function renderHistory() {
    const el = document.getElementById('historyTable');
    const subs = getSubmissions();
    const countEl = document.getElementById('historyCount');
    countEl.textContent = subs.length + ' soumission(s)';

    if (subs.length === 0) {
        el.innerHTML = '<div class="price-placeholder" style="padding:40px 0">Aucune soumission enregistree</div>';
        return;
    }

    let html = '<table class="history-table"><thead><tr>';
    html += '<th>Date</th><th>Type</th><th>Client</th><th>Adresse</th><th>Total HT</th><th>Bexio</th><th>Utilisateur</th><th></th>';
    html += '</tr></thead><tbody>';

    subs.forEach((s, i) => {
        const date = new Date(s.date).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const badgeClass = s.type === 'CECB Plus' ? 'badge-plus' : s.type === 'Conseil Incitatif' ? 'badge-conseil' : 'badge-cecb';
        html += '<tr>';
        html += '<td>' + date + '</td>';
        html += '<td><span class="badge-sm ' + badgeClass + '">' + (s.type || '') + '</span></td>';
        html += '<td>' + escapeHtml(s.client || '') + '</td>';
        html += '<td>' + escapeHtml(s.address || '') + '</td>';
        html += '<td style="font-weight:600">' + (s.total || 0) + ' CHF</td>';
        html += '<td>' + (s.quoteNr ? '#' + s.quoteNr : '<em style="color:#94A3B8">—</em>') + '</td>';
        html += '<td style="font-size:12px;color:#64748B">' + escapeHtml(s.user || '') + '</td>';
        html += '<td><button class="btn-reload" onclick="reloadSubmission(' + i + ')">Recharger</button></td>';
        html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
}

function reloadSubmission(index) {
    const subs = getSubmissions();
    const s = subs[index];
    if (!s || !s.formData) return;

    switchView('form');
    const fd = s.formData;
    Object.keys(fd).forEach(key => {
        const el = document.getElementById(key);
        if (el) {
            el.value = fd[key];
            if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change'));
        }
    });
    addLog('Soumission rechargee: ' + (s.client || ''), 'success');
    updatePricePreview();
}

function exportHistoryCSV() {
    const subs = getSubmissions();
    if (subs.length === 0) return;

    const headers = ['Date', 'Type', 'Client', 'Adresse', 'Total HT', 'Bexio Nr', 'Utilisateur', 'Message'];
    const rows = subs.map(s => [
        new Date(s.date).toLocaleDateString('fr-CH'),
        s.type || '',
        s.client || '',
        s.address || '',
        s.total || 0,
        s.quoteNr || '',
        s.user || '',
        (s.formData && s.formData.message) || ''
    ]);

    let csv = headers.join(';') + '\n';
    rows.forEach(r => {
        csv += r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';') + '\n';
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'devis-historique-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function clearHistory() {
    if (!confirm('Supprimer tout l\'historique des soumissions ?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ==========================================
// TEXT ADMINISTRATION
// ==========================================
const TEXTS_KEY = 'devis-texts';

const DEFAULT_TEXTS = {
    prestations_incluses_cecb: {
        label: 'Prestations incluses — CECB',
        value: 'Notre offre de services prévoit les prestations suivantes :<br><br>Etablissement d\'un CECB®<br>- Déplacement et visite du bâtiment pour relevés des indications nécessaires<br>- Analyse et compilation des documents reçus (factures, relevés de consommations, plans, …)<br>- Calcul et saisie de la SRE (selon affectations)<br>- Calcul, saisie et description des surfaces des éléments de l\'enveloppe (façades, vitrages, …)<br>- Estimation et saisie des coefficients de transmission thermique (valeurs U) des éléments de l\'enveloppe thermique de l\'état initial<br>- Identification et saisie des ponts thermiques de l\'état initial<br>- Estimation des surfaces de l\'enveloppe et de la surface de référence énergétique<br>- Plausibilité : Comparaison et affinage du calcul par rapport aux consommations réelles<br>- Etablissement du Certificat énergétique cantonal du bâtiment (CECB) pour l\'état actuel (pour une seule émission)<br><br>Données à fournir par le client<br>- Accès aux bâtiments (locaux communs et au moins un appartement)<br>- Plans du bâtiment en format PDF (vues en plan, coupes et élévations)<br>- Données de consommation du bâtiment sur les trois dernières années (chauffage et électricité)<br><br>La rémunération comprend tous les services fournis par Êta Consult Sàrl (y compris les dépenses et les frais de déplacement)<br><br>Si des services supplémentaires sont demandés au-delà de cette portée, les honoraires de Êta Consult Sàrl seront basés sur les taux horaires suivants :<br>- Chef de projet : 155 CHF HT (Catégorie C)<br><br>Les accès aux bâtiments sont à garantir en coordination avec nos disponibilités.'
    },
    prestations_non_incluses_cecb: {
        label: 'Prestations non-incluses — CECB',
        value: 'Prestations non-incluses :<br>- Rapport CECB® Plus<br>- Conseil Incitatif Chauffez Renouvelable®'
    },
    prestations_incluses_cecb_plus: {
        label: 'Prestations incluses — CECB Plus',
        value: 'Notre offre de services prévoit les prestations suivantes :<br><br>Etablissement d\'un CECB®<br>- Déplacement et visite du bâtiment pour relevés des indications nécessaires<br>- Analyse et compilation des documents reçus (factures, relevés de consommations, plans, …)<br>- Calcul et saisie de la SRE (selon affectations)<br>- Calcul, saisie et description des surfaces des éléments de l\'enveloppe (façades, vitrages, …)<br>- Estimation et saisie des coefficients de transmission thermique (valeurs U) des éléments de l\'enveloppe thermique de l\'état initial<br>- Identification et saisie des ponts thermiques de l\'état initial<br>- Estimation des surfaces de l\'enveloppe et de la surface de référence énergétique<br>- Plausibilité : comparaison et affinage du calcul par rapport aux consommations réelles<br>- Etablissement du CECB® pour l\'état actuel (pour une seule émission)<br><br>Etablissement d\'un certificat CECB® Plus<br>- Prise de photos supplémentaires pour le rapport de conseil<br>- Établissement de 3 variantes d\'assainissement selon discussion avec le mandant<br>- Estimation des coefficients de transmission thermique (valeurs U) des éléments de l\'enveloppe thermique rénovée<br>- Estimation des subventions pour chaque variante de rénovation proposée<br><br>Données à fournir par le client<br>- Accès aux bâtiments (locaux communs et au moins un appartement)<br>- Plans du bâtiment en format PDF (vues en plan, coupes et élévations)<br>- Données de consommation du bâtiment sur les trois dernières années (chauffage et électricité)<br>La rémunération comprend tous les services fournis par Êta Consult Sàrl (y compris les dépenses et les frais de déplacement)<br><br>Si des services supplémentaires sont demandés au-delà de cette portée, les honoraires de Êta Consult Sàrl seront basés sur les taux horaires suivants :<br>- Chef de projet : 155 CHF HT (Catégorie C)<br>Les accès aux bâtiments sont à garantir en coordination avec nos disponibilités.'
    },
    prestations_non_incluses_cecb_plus: {
        label: 'Prestations non-incluses — CECB Plus',
        value: 'Prestations non-incluses :<br>- Conseil Incitatif Chauffez Renouvelable®'
    },
    prestations_incluses_transfert: {
        label: 'Prestations incluses — Transfert CECB',
        value: 'Notre offre de services prévoit les prestations suivantes :<br><br>Mise à jour d\'un CECB®<br>- Déplacement et visite du bâtiment pour relevés des indications nécessaires<br>- Estimation et saisie des coefficients de transmission thermique (valeurs U) des éléments de l\'enveloppe thermique de l\'état rénové<br>- Etablissement du Certificat énergétique cantonal du bâtiment (CECB) pour l\'état actuel (pour une seule émission)<br><br>Données à fournir par le client<br>- Accès aux bâtiments (locaux communs et au moins un appartement)<br>- Plans du bâtiment en format PDF (vues en plan, coupes et élévations)<br><br>La rémunération comprend tous les services fournis par Êta Consult Sàrl (y compris les dépenses et les frais de déplacement)<br><br>Si des services supplémentaires sont demandés au-delà de cette portée, les honoraires de Êta Consult Sàrl seront basés sur les taux horaires suivants :<br>- Chef de projet : 155 CHF HT (Catégorie C)<br><br>Les accès aux bâtiments sont à garantir en coordination avec nos disponibilités.'
    },
    prestations_non_incluses_transfert: {
        label: 'Prestations non-incluses — Transfert CECB',
        value: 'Prestations non-incluses :<br>- Rapport CECB® Plus<br>- Conseil Incitatif Chauffez Renouvelable®'
    },
    prestations_incluses_conseil: {
        label: 'Prestations incluses — Conseil Incitatif',
        value: 'Prestations incluses :<br>- Conseil personnalisé sur les solutions de chauffage renouvelable<br>- Visite sur site<br>- Etablissement de la checklist Chauffez Renouvelable®<br>- Recommandations adaptées à votre bâtiment'
    },
    responsabilite_cecb: {
        label: 'Clause de responsabilité CECB',
        value: '<strong>Informations importantes et clause de non-responsabilité :</strong><br><br>Les classes CECB sont basées sur une méthode standardisée et simplifiée d\'estimation des besoins énergétiques des bâtiments, appuyés sur des calculs types. La valeur déterminée ne doit pas être entendue comme une valeur absolue et sert uniquement d\'indication à des fins de comparaison avec d\'autres bâtiments.<br><br>Toute responsabilité découlant des déclarations du CECB est exclue. (chapitre 11.1 du règlement d\'utilisation).'
    },
    footer_conditions: {
        label: 'Footer — Conditions de paiement',
        value: 'Conditions de paiement : Acompte de {pct_acompte}% à la commande, solde à réception du rapport.'
    },
    subventions_cecb_plus: {
        label: 'Subventions — CECB Plus',
        value: '<strong>Subventions cantonales (Canton de Vaud)</strong><br><br>Le Canton de Vaud propose une subvention aux propriétaires de bâtiments construits avant 2000 pour l\'établissement d\'un Certificat énergétique cantonal des bâtiments Plus (CECB Plus). Cette dernière n\'est pas intégrée à la présente offre d\'honoraires.<br><br>L\'aide financière est fixée selon les principes suivants :<br>- Habitat individuel: 1000 fr.<br>- Habitat collectif: 1500 fr.<br><br>Sont considérées comme habitations individuelles des constructions comprenant au maximum deux logements.<br><br><strong>IMPORTANT :</strong> La demande doit être impérativement remise avant le début de la prestation. Une subvention ne peut être accordée pour une prestation en cours (art. 24 loi du 17 novembre 1999 sur les subventions).'
    },
    footer_source: {
        label: 'Footer — Source',
        value: 'Source : Devis CECB — Êta Consult Sàrl'
    }
};

function getTexts() {
    try {
        const saved = JSON.parse(localStorage.getItem(TEXTS_KEY));
        if (!saved) return JSON.parse(JSON.stringify(DEFAULT_TEXTS));
        // Merge with defaults (in case new keys were added)
        const merged = JSON.parse(JSON.stringify(DEFAULT_TEXTS));
        Object.keys(saved).forEach(k => {
            if (merged[k]) merged[k].value = saved[k].value || saved[k];
        });
        return merged;
    } catch (e) {
        return JSON.parse(JSON.stringify(DEFAULT_TEXTS));
    }
}

function getText(key) {
    const texts = getTexts();
    return texts[key] ? texts[key].value : (DEFAULT_TEXTS[key] ? DEFAULT_TEXTS[key].value : '');
}

function renderTextsEditor() {
    const el = document.getElementById('textsEditor');
    const texts = getTexts();
    let html = '';

    Object.keys(texts).forEach(key => {
        const t = texts[key];
        html += `
        <div class="text-block">
            <div class="text-block-header">
                <span class="text-block-title">${t.label}</span>
                <span class="text-block-key">${key}</span>
            </div>
            <textarea id="text_${key}" data-key="${key}">${escapeHtml(t.value)}</textarea>
        </div>`;
    });

    el.innerHTML = html;
}

function saveTexts() {
    const texts = getTexts();
    document.querySelectorAll('#textsEditor textarea').forEach(ta => {
        const key = ta.dataset.key;
        if (texts[key]) texts[key].value = ta.value;
    });
    localStorage.setItem(TEXTS_KEY, JSON.stringify(texts));
    document.getElementById('textsStatus').textContent = 'Textes sauvegardes !';
    setTimeout(() => document.getElementById('textsStatus').textContent = '', 2000);
}

function resetTexts() {
    if (!confirm('Reinitialiser tous les textes aux valeurs par defaut ?')) return;
    localStorage.removeItem(TEXTS_KEY);
    renderTextsEditor();
    document.getElementById('textsStatus').textContent = 'Textes reinitialises';
    setTimeout(() => document.getElementById('textsStatus').textContent = '', 2000);
}

// ==========================================
// LOGGING
// ==========================================
function addLog(msg, type = 'info') {
    const el = document.getElementById('logs');
    const time = new Date().toLocaleTimeString('fr-CH');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
}

// ==========================================
// CONFIG PERSISTENCE
// ==========================================
function saveConfig() {
    const gkey = document.getElementById('googleKey').value;
    if (gkey) localStorage.setItem('google_key', gkey);
    document.getElementById('configStatus').textContent = 'Sauvegarde !';
    setTimeout(() => document.getElementById('configStatus').textContent = '', 2000);
    addLog('Configuration sauvegardee', 'success');
}

function loadConfig() {
    const gkey = localStorage.getItem('google_key');
    if (gkey) document.getElementById('googleKey').value = gkey;
}

// ==========================================
// TARIF MANAGEMENT
// ==========================================
const TARIF_LABELS = {
    base_price: { label: 'Prix de base CECB', unit: 'CHF' },
    km_factor_proche: { label: 'Facteur km (< seuil)', unit: '' },
    km_factor_loin: { label: 'Facteur km (>= seuil)', unit: '' },
    km_seuil: { label: 'Seuil distance', unit: 'km' },
    surface_factor_petit: { label: 'Facteur surface (< seuil)', unit: '' },
    surface_factor_grand: { label: 'Facteur surface (>= seuil)', unit: '' },
    surface_seuil: { label: 'Seuil surface', unit: 'm2' },
    plus_factor_petit: { label: 'Facteur Plus (< 160 m2)', unit: 'x' },
    plus_factor_moyen: { label: 'Facteur Plus (160-750 m2)', unit: 'x' },
    plus_factor_grand: { label: 'Facteur Plus (>= 750 m2)', unit: 'x' },
    plus_seuil_petit: { label: 'Seuil Plus petit', unit: 'm2' },
    plus_seuil_grand: { label: 'Seuil Plus grand', unit: 'm2' },
    plus_price_max: { label: 'Prix max CECB Plus', unit: 'CHF' },
    frais_emission_cecb: { label: 'Frais emission CECB', unit: 'CHF' },
    frais_emission_cecb_plus: { label: 'Frais emission CECB Plus', unit: 'CHF' },
    frais_maj_transfert_cecb: { label: 'Transfert du CECB', unit: 'CHF' },
    frais_maj_cecb: { label: 'Frais mise à jour CECB', unit: 'CHF' },
    demande_subvention_cecb_plus: { label: 'Demande subvention IM 07', unit: 'CHF' },
    conseil_restitution_cecb_plus: { label: 'Conseil restitution CECB Plus', unit: 'CHF/h' },
    prix_conseil_incitatif: { label: 'Prix Conseil Incitatif', unit: 'CHF' },
    forfait_normal: { label: 'Forfait Normal', unit: 'CHF' },
    forfait_express: { label: 'Forfait Express', unit: 'CHF' },
    forfait_urgent: { label: 'Forfait Urgent', unit: 'CHF' },
    pct_acompte: { label: 'Acompte', unit: '%' }
};

function loadTarifs() {
    const saved = localStorage.getItem('devis_tarifs');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(TARIFS, parsed);
        } catch (e) { /* ignore */ }
    }
}

function renderTarifGrid() {
    const grid = document.getElementById('tarifGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const active = getActiveTarifs();
    for (const [key, val] of Object.entries(active)) {
        const meta = TARIF_LABELS[key] || { label: key, unit: '' };
        const item = document.createElement('div');
        item.className = 'tarif-item';
        item.innerHTML = `
            <label for="tarif_${key}">${meta.label}</label>
            <input type="number" id="tarif_${key}" value="${val}" step="any" data-key="${key}">
            <span class="tarif-unit">${meta.unit}</span>
        `;
        grid.appendChild(item);
    }

    // Listener: modification → tarifs temporaires en live
    grid.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            const newTarifs = {};
            grid.querySelectorAll('input').forEach(i => {
                const v = parseFloat(i.value);
                if (!isNaN(v)) newTarifs[i.dataset.key] = v;
            });
            tempTarifs = Object.assign({}, TARIFS, newTarifs);
            updatePricePreview();
            const cancelBtn = document.getElementById('cancelTempTarifs');
            if (cancelBtn) cancelBtn.style.display = '';
        });
    });
}

function getActiveTarifs() {
    return tempTarifs || TARIFS;
}

function saveTarifs() {
    const oldTarifs = Object.assign({}, TARIFS);

    // Lire les nouvelles valeurs depuis le formulaire
    const newTarifs = {};
    const inputs = document.querySelectorAll('#tarifGrid input');
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        const val = parseFloat(inp.value);
        if (!isNaN(val)) newTarifs[key] = val;
    });

    // Enregistrer dans l'historique
    logTarifChange('permanent', oldTarifs, newTarifs);

    // Sauvegarde permanente dans localStorage
    Object.assign(TARIFS, newTarifs);
    localStorage.setItem('devis_tarifs', JSON.stringify(TARIFS));
    tempTarifs = null;
    const cancelBtn = document.getElementById('cancelTempTarifs');
    if (cancelBtn) cancelBtn.style.display = 'none';
    document.getElementById('tarifStatus').textContent = 'Tarifs sauvegardes !';
    addLog('Tarifs mis a jour (permanent)', 'success');

    setTimeout(() => document.getElementById('tarifStatus').textContent = '', 3000);
    updatePricePreview();
    renderTarifHistory();
}

function clearTempTarifs() {
    tempTarifs = null;
    loadTarifs();
    renderTarifGrid();
    updatePricePreview();
    renderTarifHistory();
    addLog('Tarifs temporaires annules', 'info');
}

function resetTarifs() {
    localStorage.removeItem('devis_tarifs');
    tempTarifs = null;
    Object.assign(TARIFS, {
        base_price: 500, km_factor_proche: 0.9, km_factor_loin: 0.7, km_seuil: 25,
        surface_factor_petit: 0.7, surface_factor_grand: 0.6, surface_seuil: 750,
        plus_factor_petit: 3.69, plus_factor_moyen: 2.29, plus_factor_grand: 1.79,
        plus_seuil_petit: 160, plus_seuil_grand: 750, plus_price_max: 1989,
        frais_emission_cecb: 80, frais_emission_cecb_plus: 110, frais_maj_transfert_cecb: 90,
        demande_subvention_cecb_plus: 155, conseil_restitution_cecb_plus: 155, prix_conseil_incitatif: 0,
        forfait_normal: 0, forfait_express: 155, forfait_urgent: 310, pct_acompte: 30
    });
    renderTarifGrid();
    updatePricePreview();
    renderTarifHistory();
    document.getElementById('tarifStatus').textContent = 'Tarifs reinitialises';
    setTimeout(() => document.getElementById('tarifStatus').textContent = '', 2000);
    addLog('Tarifs reinitialises aux valeurs par defaut', 'info');
}

// ==========================================
// TARIF HISTORY
// ==========================================
function logTarifChange(type, oldTarifs, newTarifs) {
    const changes = [];
    for (const key of Object.keys(newTarifs)) {
        const oldVal = oldTarifs[key];
        const newVal = newTarifs[key];
        if (oldVal !== newVal) {
            const meta = TARIF_LABELS[key] || { label: key, unit: '' };
            changes.push({ key, label: meta.label, old: oldVal, new: newVal, unit: meta.unit });
        }
    }
    if (changes.length === 0) return;

    const session = typeof getSession === 'function' ? getSession() : null;
    const entry = {
        date: new Date().toISOString(),
        user: session ? session.email : 'inconnu',
        type,
        changes
    };

    let history = [];
    try { history = JSON.parse(localStorage.getItem(TARIF_HISTORY_KEY)) || []; } catch (e) { /* ignore */ }
    history.unshift(entry);
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem(TARIF_HISTORY_KEY, JSON.stringify(history));
}

function renderTarifHistory() {
    const el = document.getElementById('tarifHistory');
    if (!el) return;

    // Afficher/masquer le bouton d'annulation des tarifs temporaires
    const cancelBtn = document.getElementById('cancelTempTarifs');
    if (cancelBtn) cancelBtn.style.display = tempTarifs ? '' : 'none';

    let history = [];
    try { history = JSON.parse(localStorage.getItem(TARIF_HISTORY_KEY)) || []; } catch (e) { /* ignore */ }

    if (history.length === 0) {
        el.innerHTML = '<div style="color:#94A3B8;font-size:13px;padding:8px 0">Aucune modification enregistree</div>';
        return;
    }

    let html = '<table class="history-table" style="font-size:12px"><thead><tr>';
    html += '<th>Date</th><th>Type</th><th>Modifications</th><th></th>';
    html += '</tr></thead><tbody>';

    history.slice(0, 20).forEach((entry, idx) => {
        const date = new Date(entry.date).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const badgeClass = entry.type === 'temporaire' ? 'badge-sm badge-conseil' : 'badge-sm badge-cecb';
        const changesHtml = entry.changes.map(c => `${c.label}: ${c.old} -> ${c.new} ${c.unit || ''}`).join('<br>');
        html += `<tr>`;
        html += `<td>${date}</td>`;
        html += `<td><span class="${badgeClass}">${entry.type}</span></td>`;
        html += `<td>${changesHtml}</td>`;
        html += `<td><button onclick="deleteTarifHistoryEntry(${idx})" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:14px" title="Supprimer">✕</button></td>`;
        html += `</tr>`;
    });

    html += '</tbody></table>';
    el.innerHTML = html;
}

function deleteTarifHistoryEntry(idx) {
    let history = [];
    try { history = JSON.parse(localStorage.getItem(TARIF_HISTORY_KEY)) || []; } catch (e) { /* ignore */ }
    history.splice(idx, 1);
    localStorage.setItem(TARIF_HISTORY_KEY, JSON.stringify(history));
    renderTarifHistory();
}

// ==========================================
// SWISSTOPO ADDRESS AUTOCOMPLETE
// ==========================================
function setupAutocomplete(inputId, sugBoxId, type) {
    const input = document.getElementById(inputId);
    const sugBox = document.getElementById(sugBoxId);

    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = input.value.trim();
        if (q.length < 3) { sugBox.classList.remove('open'); return; }

        searchTimeout = setTimeout(async () => {
            try {
                const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(q)}&type=locations&origins=address&limit=8&sr=4326`;
                const res = await fetch(url);
                const data = await res.json();

                sugBox.innerHTML = '';
                if (!data.results || data.results.length === 0) {
                    sugBox.classList.remove('open');
                    return;
                }

                data.results.forEach(r => {
                    const attrs = r.attrs;
                    const label = attrs.label.replace(/<[^>]*>/g, '');
                    const div = document.createElement('div');
                    div.className = 'sug-item';
                    div.innerHTML = `<div>${label}</div>`;
                    div.addEventListener('click', () => {
                        selectAddress(attrs, type);
                        sugBox.classList.remove('open');
                    });
                    sugBox.appendChild(div);
                });
                sugBox.classList.add('open');
            } catch (err) {
                addLog(`Erreur recherche: ${err.message}`, 'error');
            }
        }, 300);
    });

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !sugBox.contains(e.target)) {
            sugBox.classList.remove('open');
        }
    });
}

function selectAddress(attrs, type) {
    // Parse label: "Rue du Port 15 <b>1180 Rolle</b>" → street, NPA, city
    const cleanLabel = attrs.label.replace(/<[^>]*>/g, '');
    // detail format: "rue du port 15 1180 rolle 5861 rolle ch vd"
    // label format: "Rue du Port 15 1180 Rolle"
    // Extract NPA (4-digit Swiss postal code) from the clean label
    const npaMatch = cleanLabel.match(/\b(\d{4})\b/);
    let street, zip, city;

    if (npaMatch) {
        const npaIndex = cleanLabel.indexOf(npaMatch[1]);
        street = cleanLabel.substring(0, npaIndex).trim();
        const afterNpa = cleanLabel.substring(npaIndex + 4).trim();
        zip = npaMatch[1];
        city = afterNpa;
    } else {
        street = cleanLabel.split(',')[0].trim();
        zip = '';
        city = '';
    }

    document.getElementById(`rue_${type}`).value = street;
    document.getElementById(`npa_${type}`).value = zip;
    document.getElementById(`localite_${type}`).value = city;

    addLog(`Adresse ${type}: ${street}, ${zip} ${city}`, 'success');

    // If "identical" is checked, also fill building
    if (type === 'facturation' && document.getElementById('adresse_identique').checked) {
        document.getElementById('rue_batiment').value = street;
        document.getElementById('npa_batiment').value = zip;
        document.getElementById('localite_batiment').value = city;
        fetchBuildingData(street, zip, city, attrs.y, attrs.x);
    }

    if (type === 'batiment') {
        fetchBuildingData(street, zip, city, attrs.y, attrs.x);
    }
}

// ==========================================
// REGBL BUILDING DATA
// ==========================================
async function fetchBuildingData(street, npa, city, easting, northing) {
    addLog('Recherche RegBL en cours...', 'info');

    try {
        // First try: search address to get precise coordinates
        const searchUrl = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(street + ' ' + npa + ' ' + city)}&type=locations&origins=address&limit=1&sr=2056`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        let e, n;
        if (searchData.results && searchData.results.length > 0) {
            e = searchData.results[0].attrs.y; // easting LV95
            n = searchData.results[0].attrs.x; // northing LV95
        } else if (easting && northing) {
            // Fallback to WGS84 coords (need conversion, use as-is with SR=4326)
            addLog('Coordonnees approximatives utilisees', 'warning');
            e = easting;
            n = northing;
        } else {
            addLog('Batiment non trouve dans le RegBL', 'warning');
            return;
        }

        // RegBL identify
        const identifyUrl = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometry=${e},${n}&geometryType=esriGeometryPoint&mapExtent=0,0,100,100&imageDisplay=100,100,100&tolerance=10&layers=all:ch.bfs.gebaeude_wohnungs_register&sr=2056&returnGeometry=false`;
        const identifyRes = await fetch(identifyUrl);
        const identifyData = await identifyRes.json();

        if (!identifyData.results || identifyData.results.length === 0) {
            addLog('Aucune donnee RegBL trouvee', 'warning');
            updateBuildingDisplay(null);
            return;
        }

        const bldg = identifyData.results[0].attributes;
        buildingData = {
            egid: bldg.egid || '—',
            garea: bldg.garea || 0,
            gastw: bldg.gastw || 2,
            gbauj: bldg.gbauj || '—',
            gbaup: bldg.gbaup || '—',
            gklas: bldg.gklas || '—',
            gebnr: bldg.gebnr || '—',
            lparz: bldg.lparz || '—',
            strname_deinr: bldg.strname_deinr || street,
            dplzname: bldg.dplzname || `${npa} ${city}`,
            ganzwhg: bldg.ganzwhg || '—',
            gebf: bldg.gebf || 0
        };

        // Update floors from RegBL
        document.getElementById('nombre_etages').value = buildingData.gastw;
        addLog(`RegBL: EGID ${buildingData.egid}, ${buildingData.gastw} etages, ${buildingData.garea} m2`, 'success');
        updateBuildingDisplay(buildingData);
        updatePricePreview();

        // Calculer la distance via Google Maps (async, met a jour le preview)
        fetchDistance(street, npa, city);
    } catch (err) {
        addLog(`Erreur RegBL: ${err.message}`, 'error');
    }
}

function updateBuildingDisplay(data) {
    const el = document.getElementById('buildingData');
    if (!data) {
        el.innerHTML = '<div class="price-placeholder">Aucune donnee RegBL disponible</div>';
        return;
    }

    el.innerHTML = `
        <div class="building-grid">
            <div class="building-item"><span class="building-label">EGID</span><span class="building-value">${data.egid}</span></div>
            <div class="building-item"><span class="building-label">Surface sol</span><span class="building-value">${data.garea} m2</span></div>
            <div class="building-item"><span class="building-label">Etages</span><span class="building-value">${data.gastw}</span></div>
            <div class="building-item"><span class="building-label">Annee</span><span class="building-value">${data.gbauj}</span></div>
            <div class="building-item"><span class="building-label">Logements</span><span class="building-value">${data.ganzwhg}</span></div>
            <div class="building-item"><span class="building-label">Parcelle</span><span class="building-value">${data.lparz}</span></div>
        </div>
    `;
}

// ==========================================
// GOOGLE MAPS DISTANCE
// ==========================================
let distanceFetchFailed = false; // true si la distance n'a pas pu être récupérée

async function fetchDistance(street, npa, city, retries = 2) {
    const destination = `${street}, ${npa} ${city}, Suisse`;
    const origin = 'Route de l\'Hôpital 16b, 1180 Rolle, Suisse';
    const params = new URLSearchParams({ origins: origin, destinations: destination });

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (attempt > 0) {
                addLog(`Retry distance (${attempt}/${retries})...`, 'info');
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
            const res = await fetch(`/api/distance?${params}`);
            const data = await res.json();

            if (data.distance_km !== undefined) {
                cachedDistanceKm = data.distance_km;
                distanceFetchFailed = false;
                addLog(`Distance Google Maps: ${cachedDistanceKm} km (${data.duration || ''})`, 'success');
                updatePricePreview();
                return;
            } else {
                addLog(`Distance non disponible: ${data.error || 'erreur inconnue'}`, 'warning');
            }
        } catch (err) {
            if (attempt < retries) continue;
            addLog(`Erreur calcul distance: ${err.message}`, 'warning');
        }
    }
    distanceFetchFailed = true;
    updatePricePreview();
}

// ==========================================
// PRICING CALCULATOR
// ==========================================
function getCoefficient(value) {
    const map = {
        'Non chauffe ou inexistant': 0,
        'Partiellement chauffe 50%': 0.5,
        'Chauffe 30%': 0.3,
        'Chauffe': 1
    };
    return map[value] || 0;
}

function getForfaitExecution(delai) {
    const t = getActiveTarifs();
    if (delai.includes('Express')) return t.forfait_express;
    if (delai.includes('Urgent')) return t.forfait_urgent;
    return t.forfait_normal;
}

function calculatePricing() {
    const t = getActiveTarifs();
    const type = document.getElementById('type_certificat').value;
    const gastw = parseInt(document.getElementById('nombre_etages').value) || 2;
    const sousSol = document.getElementById('sous_sol').value;
    const combles = document.getElementById('combles').value;
    const delai = document.getElementById('delai').value;
    const garea = buildingData ? (buildingData.garea || 0) : 0;

    if (type === 'Conseil Incitatif') {
        return { type, total: 0, lines: [{ label: 'Conseil Incitatif', value: 'Gratuit' }] };
    }

    // Equivalent floors & surface
    const etEq = gastw + getCoefficient(sousSol) + getCoefficient(combles);
    const sEq = etEq * garea;

    // Distance Google Maps (mise a jour async via fetchDistance)
    const distKm = cachedDistanceKm;

    // CECB price
    const kmFactor = distKm < t.km_seuil ? t.km_factor_proche : t.km_factor_loin;
    const surfFactor = sEq < t.surface_seuil ? t.surface_factor_petit : t.surface_factor_grand;
    const cecbPrice = Math.round(t.base_price + (distKm * kmFactor) + (sEq * surfFactor));

    const lines = [];
    const isTransfert = type === 'Transfert CECB';
    const isPlusTransfert = type === 'CECB Plus Transfert';

    // CECB Plus avec transfert
    if (isPlusTransfert) {
        const rabaisEl = document.getElementById('rabais_transfert');
        const rabaisPct = rabaisEl ? (parseFloat(rabaisEl.value) || 0) : 0;
        const prixReduit = Math.round(cecbPrice * (1 - rabaisPct / 100));
        lines.push({ label: `Transfert CECB (Seq: ${Math.round(sEq)} m2, -${rabaisPct}%)`, value: `${prixReduit} CHF` });
        lines.push({ label: 'Transfert du CECB', value: `${t.frais_maj_transfert_cecb} CHF` });
        lines.push({ label: 'Frais de mise à jour CECB', value: `${t.frais_maj_cecb} CHF` });
        let total = prixReduit + t.frais_maj_transfert_cecb + t.frais_maj_cecb;

        // Plus basé sur cecbPrice brut (avant rabais)
        let plusFactor;
        if (sEq < t.plus_seuil_petit) plusFactor = t.plus_factor_petit;
        else if (sEq < t.plus_seuil_grand) plusFactor = t.plus_factor_moyen;
        else plusFactor = t.plus_factor_grand;

        const plusPrice = Math.min(t.plus_price_max, Math.round(cecbPrice * plusFactor));
        lines.push({ label: `CECB Plus (x${plusFactor})`, value: `${plusPrice} CHF` });
        total += plusPrice;

        lines.push({ label: 'Frais emission CECB Plus', value: `${t.frais_emission_cecb_plus} CHF` });
        total += t.frais_emission_cecb_plus;

        const subvEl = document.getElementById('inclure_subvention');
        if (subvEl && subvEl.checked) {
            lines.push({ label: 'Demande subvention IM-07', value: `${t.demande_subvention_cecb_plus} CHF` });
            total += t.demande_subvention_cecb_plus;
        }

        const conseilPrice = 1.5 * t.conseil_restitution_cecb_plus;
        lines.push({ label: 'Conseil restitution (1.5h)', value: `${conseilPrice} CHF` });
        total += conseilPrice;

        const forfait = getForfaitExecution(delai);
        if (forfait > 0) {
            lines.push({ label: `Forfait ${delai.split('(')[0].trim()}`, value: `${forfait} CHF` });
            total += forfait;
        }
        return { type, total, lines };
    }

    if (isTransfert) {
        const rabaisEl = document.getElementById('rabais_transfert');
        const rabaisPct = rabaisEl ? (parseFloat(rabaisEl.value) || 0) : 0;
        const prixReduit = Math.round(cecbPrice * (1 - rabaisPct / 100));
        lines.push({ label: `Transfert CECB (Seq: ${Math.round(sEq)} m2, -${rabaisPct}%)`, value: `${prixReduit} CHF` });
        lines.push({ label: 'Transfert du CECB', value: `${t.frais_maj_transfert_cecb} CHF` });
        let total = prixReduit + t.frais_maj_transfert_cecb;

        const forfait = getForfaitExecution(delai);
        if (forfait > 0) {
            lines.push({ label: `Forfait ${delai.split('(')[0].trim()}`, value: `${forfait} CHF` });
            total += forfait;
        }
        return { type, total, lines };
    }

    lines.push({ label: `CECB (Seq: ${Math.round(sEq)} m2)`, value: `${cecbPrice} CHF` });
    lines.push({ label: 'Frais emission CECB', value: `${t.frais_emission_cecb} CHF` });

    let total = cecbPrice + t.frais_emission_cecb;

    // CECB Plus
    if (type === 'CECB Plus') {
        let plusFactor;
        if (sEq < t.plus_seuil_petit) plusFactor = t.plus_factor_petit;
        else if (sEq < t.plus_seuil_grand) plusFactor = t.plus_factor_moyen;
        else plusFactor = t.plus_factor_grand;

        const plusPrice = Math.min(t.plus_price_max, Math.round(cecbPrice * plusFactor));
        lines.push({ label: `CECB Plus (x${plusFactor})`, value: `${plusPrice} CHF` });
        total += plusPrice;

        // Frais emission CECB Plus
        lines.push({ label: 'Frais emission CECB Plus', value: `${t.frais_emission_cecb_plus} CHF` });
        total += t.frais_emission_cecb_plus;

        // Subvention IM-07
        const subvEl = document.getElementById('inclure_subvention');
        if (subvEl && subvEl.checked) {
            lines.push({ label: 'Demande subvention IM-07', value: `${t.demande_subvention_cecb_plus} CHF` });
            total += t.demande_subvention_cecb_plus;
        }

        // Conseil restitution
        const conseilPrice = 1.5 * t.conseil_restitution_cecb_plus;
        lines.push({ label: 'Conseil restitution (1.5h)', value: `${conseilPrice} CHF` });
        total += conseilPrice;
    }

    // Forfait execution
    const forfait = getForfaitExecution(delai);
    if (forfait > 0) {
        lines.push({ label: `Forfait ${delai.split('(')[0].trim()}`, value: `${forfait} CHF` });
        total += forfait;
    }

    return { type, total, lines };
}

function updatePricePreview() {
    const el = document.getElementById('pricePreview');
    const pricing = calculatePricing();

    if (pricing.type === 'Conseil Incitatif') {
        el.innerHTML = `
            <div class="price-line">
                <span class="price-label">Conseil Incitatif</span>
                <span class="price-badge badge-conseil">Gratuit</span>
            </div>
        `;
        return;
    }

    const badgeClass = pricing.type === 'CECB Plus' ? 'badge-plus' : 'badge-cecb';

    let html = '';
    if (tempTarifs) {
        html += `<div style="margin-bottom:8px;padding:6px 10px;background:#FFF7ED;border:1px solid #FDBA74;border-radius:6px;font-size:12px;color:#C2410C;font-weight:600">&#9888; Tarifs temporaires actifs — prochain devis uniquement <button onclick="clearTempTarifs()" style="margin-left:8px;font-size:11px;padding:2px 8px;border:1px solid #C2410C;border-radius:3px;background:#fff;color:#C2410C;cursor:pointer">Annuler</button></div>`;
    }
    html += `<div style="margin-bottom:8px"><span class="price-badge ${badgeClass}">${pricing.type}</span></div>`;
    pricing.lines.forEach(l => {
        html += `<div class="price-line"><span class="price-label">${l.label}</span><span class="price-value">${l.value}</span></div>`;
    });
    html += `<div class="price-total"><span>Total HT</span><span>${pricing.total} CHF</span></div>`;
    const tva = Math.round(pricing.total * 8.1) / 100;
    const ttc = Math.round((pricing.total + tva) * 100) / 100;
    html += `<div class="price-line" style="font-size:12px;color:#64748B;margin-top:2px"><span class="price-label">TVA 8.1%</span><span class="price-value">${tva.toFixed(2)} CHF</span></div>`;
    html += `<div class="price-total" style="margin-top:2px"><span>Total TTC</span><span>${ttc.toFixed(2)} CHF</span></div>`;

    if (!buildingData || !buildingData.garea) {
        html += `<div style="margin-top:8px;font-size:12px;color:#D97706">Surface inconnue — prix indicatif (base uniquement)</div>`;
    }
    if (distanceFetchFailed || (buildingData && cachedDistanceKm === 0)) {
        html += `<div style="margin-top:8px;font-size:12px;color:#DC2626">&#9888; Distance non disponible — prix sans frais de deplacement</div>`;
    }

    el.innerHTML = html;
}

// ==========================================
// BEXIO API
// ==========================================
async function bexioRequest(method, endpoint, body = null) {
    const url = getBexioUrl(endpoint);
    const opts = {
        method,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bexio ${res.status}: ${text}`);
    }
    return res.json();
}

async function searchContact(name) {
    const data = await bexioRequest('POST', '/2.0/contact/search', [
        { field: 'name_1', value: name, criteria: 'like' }
    ]);
    return data;
}

function buildContactPayload(formData) {
    const isPrive = formData.type_contact === 'Prive';
    const payload = {
        contact_type_id: isPrive ? 2 : 1,  // Bexio: 1=Firma, 2=Privat
        name_1: isPrive ? formData.nom_famille : formData.nom_entreprise,
        name_2: isPrive ? formData.prenom : '',
        postcode: formData.npa_facturation,
        city: formData.localite_facturation,
        country_id: 1, // Switzerland
        mail: formData.email,
        phone_fixed: formData.telephone || '',
        user_id: BEXIO_IDS.user_id,
        owner_id: BEXIO_IDS.user_id,
        language_id: BEXIO_IDS.language_id
    };

    // Bexio v2: "address" est en lecture seule, utiliser street_name + house_number
    if (formData.rue_facturation) {
        const parts = formData.rue_facturation.match(/^(.+?)\s+(\d+\s*\w*)$/);
        if (parts) {
            payload.street_name = parts[1];
            payload.house_number = parts[2];
        } else {
            payload.street_name = formData.rue_facturation;
        }
    }

    const salutMap = { 'M.': 1, 'Mme': 2 };  // Bexio: 1=Herr, 2=Frau
    if (salutMap[formData.appellation]) {
        payload.salutation_id = salutMap[formData.appellation];
    }

    return payload;
}

async function createContact(formData) {
    return bexioRequest('POST', '/2.0/contact', buildContactPayload(formData));
}

async function updateContact(contactId, formData) {
    return bexioRequest('POST', `/2.0/contact/${contactId}`, buildContactPayload(formData));
}

async function createBexioQuote(formData, contactId) {
    const type = formData.type_certificat;
    const adresse = formData.rue_batiment || formData.rue_facturation;
    const npa = formData.npa_batiment || formData.npa_facturation;
    const loc = formData.localite_batiment || formData.localite_facturation;
    const displayType = type === 'CECB Plus Transfert' ? 'CECB Plus (transfert)' : type;
    const title = `${displayType} - ${adresse}, ${npa}, ${loc}`;

    const positions = buildPositions(formData, type);
    const footerCond = getText('footer_conditions').replace('{pct_acompte}', TARIFS.pct_acompte);
    const footerSrc = getText('footer_source');
    const footer = footerCond + '<br><br>' + footerSrc;

    const header = (formData.message || '').trim().replace(/\n/g, '<br>') || '\u00A0';  // Espace insecable pour eviter le template Bexio par defaut

    const payload = {
        contact_id: contactId,
        user_id: BEXIO_IDS.user_id,
        title,
        header,
        mwst_type: BEXIO_IDS.mwst_type,
        currency_id: BEXIO_IDS.currency_id,
        language_id: BEXIO_IDS.language_id,
        footer,
        positions
    };

    return bexioRequest('POST', '/2.0/kb_offer', payload);
}

function buildPositions(formData, type) {
    const adresse = formData.rue_batiment || formData.rue_facturation;
    const npa = formData.npa_batiment || formData.npa_facturation;
    const loc = formData.localite_batiment || formData.localite_facturation;
    const bd = buildingData || {};
    const positions = [];

    if (type === 'Conseil Incitatif') {
        // Conseil Incitatif position
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(TARIFS.prix_conseil_incitatif),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: `Conseil incitatif Chauffez renouvelable® :<br>- EGID n°${bd.egid || '—'}<br>- ${adresse}, ${npa} ${loc}`
        });
        // Prestations text
        positions.push({
            type: 'KbPositionText',
            text: getText('prestations_incluses_conseil')
        });
        // Message du prospect → va dans le header du devis
        return positions;
    }

    // Main position
    const pricing = calculatePricing();
    const mainPrice = pricing.lines[0] ? parseInt(pricing.lines[0].value) || 0 : 0;
    const isTransfert = type === 'Transfert CECB';
    const isPlusTransfert = type === 'CECB Plus Transfert';
    const buildingDesc = `- EGID n°${bd.egid || '—'}<br>- ${adresse}, ${npa} ${loc}<br>- ${bd.gastw || 2} niveaux hors sol<br>- Surface au sol ${bd.garea || '?'} m²<br>- Année de construction : ${bd.gbauj || '?'}`;

    // CECB Plus avec transfert
    if (isPlusTransfert) {
        const t = getActiveTarifs();

        // Transfert du CECB (avant la position principale)
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(t.frais_maj_transfert_cecb),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: 'Transfert du CECB'
        });

        // Mise à jour CECB (prix reduit)
        positions.push({
            type: 'KbPositionArticle',
            article_id: 4,  // Mise a jour CECB
            amount: '1',
            unit_price: String(mainPrice),
            tax_id: BEXIO_IDS.tax_id,
            text: `Mise à jour du certificat CECB® :<br>${buildingDesc}`
        });

        // Frais de mise à jour CECB
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(t.frais_maj_cecb),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: 'Frais de mise à jour du CECB sur la plateforme CECB (nouveaux tarifs à partir du 01.01.2026)'
        });

        // CECB Plus (prix basé sur cecbPrice brut)
        const plusLine = pricing.lines.find(l => l.label.includes('Plus'));
        const plusPrice = plusLine ? parseInt(plusLine.value) || 0 : 0;
        positions.push({
            type: 'KbPositionArticle',
            article_id: BEXIO_IDS.article_cecb_plus,
            amount: '1',
            unit_price: String(plusPrice),
            tax_id: BEXIO_IDS.tax_id,
            text: `Etablissement d'un certificat CECB® Plus, en sus :<br>- ${adresse}, ${npa} ${loc}`
        });

        // Frais emission CECB Plus
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(t.frais_emission_cecb_plus),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: 'Frais d\'émission du rapport CECB Plus sur la plateforme (nouveaux tarifs à partir du 01.01.2026)'
        });

        // Subventions info text
        positions.push({
            type: 'KbPositionText',
            text: getText('subventions_cecb_plus')
        });

        // Demande de subvention IM-07
        const subvEl = document.getElementById('inclure_subvention');
        if (subvEl && subvEl.checked) {
            positions.push({
                type: 'KbPositionCustom',
                amount: '1',
                unit_price: String(t.demande_subvention_cecb_plus),
                unit_id: BEXIO_IDS.unit_id,
                tax_id: BEXIO_IDS.tax_id,
                text: 'Demande de subvention par l\'expert CECB selon les conditions d\'éligibilité du Programme des Bâtiments :<br>- Mesure IM-07: Etablissement d\'un CECB®Plus'
            });
        }

        // Conseil et restitution du rapport CECB Plus
        positions.push({
            type: 'KbPositionCustom',
            amount: '1.5',
            unit_price: String(t.conseil_restitution_cecb_plus),
            unit_id: 1,  // heures
            tax_id: BEXIO_IDS.tax_id,
            text: 'Conseils à la restitution du rapport CECB®Plus<br>- Lecture commentée du rapport de conseil'
        });

        // Forfait execution
        const forfait = getForfaitExecution(formData.delai || 'Normal');
        if (forfait > 0) {
            positions.push({
                type: 'KbPositionArticle',
                article_id: BEXIO_IDS.article_forfait_execution,
                amount: '1',
                unit_price: String(forfait),
                tax_id: BEXIO_IDS.tax_id,
                text: `Forfait relatif au délai d'exécution :<br>- Normal > 10 jours ouvrés, à convenir : 0.- HT<br>- Express < 5 jours ouvrés : 155.- HT<br>- Urgent < 48h : 310.- HT`
            });
        }

        // Prestations incluses
        positions.push({
            type: 'KbPositionText',
            text: getText('prestations_incluses_cecb_plus')
        });

        // Prestations non-incluses
        const nonIncluses = getText('prestations_non_incluses_cecb_plus');
        if (nonIncluses) {
            positions.push({
                type: 'KbPositionText',
                text: nonIncluses
            });
        }

        // Responsabilite
        positions.push({
            type: 'KbPositionText',
            text: getText('responsabilite_cecb')
        });

        return positions;
    }

    // Transfert du CECB — avant la position principale pour Transfert CECB
    if (isTransfert) {
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(getActiveTarifs().frais_maj_transfert_cecb),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: 'Transfert du CECB'
        });
    }

    positions.push({
        type: 'KbPositionArticle',
        article_id: isTransfert ? 4 : BEXIO_IDS.article_cecb,  // 4 = Mise a jour CECB
        amount: '1',
        unit_price: String(mainPrice),
        tax_id: BEXIO_IDS.tax_id,
        text: isTransfert
            ? `Mise à jour du certificat CECB® :<br>${buildingDesc}`
            : `Etablissement d'un certificat CECB® :<br>${buildingDesc}`
    });

    // Frais emission — pas pour Transfert CECB
    if (!isTransfert) {
        positions.push({
            type: 'KbPositionArticle',
            article_id: BEXIO_IDS.article_frais_emission,
            amount: '1',
            unit_price: String(getActiveTarifs().frais_emission_cecb),
            tax_id: BEXIO_IDS.tax_id,
            text: 'Frais d\'émission du rapport CECB sur la plateforme (nouveaux tarifs à partir du 01.01.2026)'
        });
    }

    // CECB Plus
    if (type === 'CECB Plus') {
        const plusLine = pricing.lines.find(l => l.label.includes('Plus'));
        const plusPrice = plusLine ? parseInt(plusLine.value) || 0 : 0;

        positions.push({
            type: 'KbPositionArticle',
            article_id: BEXIO_IDS.article_cecb_plus,
            amount: '1',
            unit_price: String(plusPrice),
            tax_id: BEXIO_IDS.tax_id,
            text: `Etablissement d'un certificat CECB® Plus, en sus :<br>- ${adresse}, ${npa} ${loc}`
        });

        // Frais emission CECB Plus
        positions.push({
            type: 'KbPositionCustom',
            amount: '1',
            unit_price: String(getActiveTarifs().frais_emission_cecb_plus),
            unit_id: BEXIO_IDS.unit_id,
            tax_id: BEXIO_IDS.tax_id,
            text: 'Frais d\'émission du rapport CECB Plus sur la plateforme (nouveaux tarifs à partir du 01.01.2026)'
        });

        // Subventions info text
        positions.push({
            type: 'KbPositionText',
            text: getText('subventions_cecb_plus')
        });

        // Demande de subvention IM-07
        const subvEl = document.getElementById('inclure_subvention');
        if (subvEl && subvEl.checked) {
            positions.push({
                type: 'KbPositionCustom',
                amount: '1',
                unit_price: String(getActiveTarifs().demande_subvention_cecb_plus),
                unit_id: BEXIO_IDS.unit_id,
                tax_id: BEXIO_IDS.tax_id,
                text: 'Demande de subvention par l\'expert CECB selon les conditions d\'éligibilité du Programme des Bâtiments :<br>- Mesure IM-07: Etablissement d\'un CECB®Plus'
            });
        }

        // Conseil et restitution du rapport CECB Plus
        positions.push({
            type: 'KbPositionCustom',
            amount: '1.5',
            unit_price: String(getActiveTarifs().conseil_restitution_cecb_plus),
            unit_id: 1,  // heures
            tax_id: BEXIO_IDS.tax_id,
            text: 'Conseils à la restitution du rapport CECB®Plus<br>- Lecture commentée du rapport de conseil'
        });
    }

    // Forfait execution
    const forfait = getForfaitExecution(formData.delai || 'Normal');
    if (forfait > 0) {
        const delaiLabel = (formData.delai || 'Normal').split('(')[0].trim();
        positions.push({
            type: 'KbPositionArticle',
            article_id: BEXIO_IDS.article_forfait_execution,
            amount: '1',
            unit_price: String(forfait),
            tax_id: BEXIO_IDS.tax_id,
            text: `Forfait relatif au délai d'exécution :<br>- Normal > 10 jours ouvrés, à convenir : 0.- HT<br>- Express < 5 jours ouvrés : 155.- HT<br>- Urgent < 48h : 310.- HT`
        });
    }

    // Prestations incluses
    const prestationsKey = isTransfert ? 'prestations_incluses_transfert'
        : type === 'CECB Plus' ? 'prestations_incluses_cecb_plus' : 'prestations_incluses_cecb';
    positions.push({
        type: 'KbPositionText',
        text: getText(prestationsKey)
    });

    // Prestations non-incluses
    const nonInclusesKey = isTransfert ? 'prestations_non_incluses_transfert'
        : type === 'CECB Plus' ? 'prestations_non_incluses_cecb_plus' : 'prestations_non_incluses_cecb';
    const nonIncluses = getText(nonInclusesKey);
    if (nonIncluses) {
        positions.push({
            type: 'KbPositionText',
            text: nonIncluses
        });
    }

    // Responsabilite text
    positions.push({
        type: 'KbPositionText',
        text: getText('responsabilite_cecb')
    });

    // Message du prospect → va dans le header du devis (pas en position)

    return positions;
}

// ==========================================
// FORM SUBMISSION
// ==========================================
async function handleSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creation en cours...';

    const form = document.getElementById('devisForm');
    const fd = new FormData(form);
    const data = {};
    fd.forEach((v, k) => { data[k] = v; });

    // Copy addresses if identical
    if (document.getElementById('adresse_identique').checked) {
        data.rue_batiment = data.rue_facturation;
        data.npa_batiment = data.npa_facturation;
        data.localite_batiment = data.localite_facturation;
    }

    // Avertir si la distance n'a pas été récupérée
    if (data.type_certificat !== 'Conseil Incitatif' && (distanceFetchFailed || cachedDistanceKm === 0)) {
        if (!confirm('La distance n\'a pas pu être calculée. Le prix ne comprend pas les frais de déplacement.\n\nCréer le devis quand même ?')) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Creer le devis dans Bexio';
            return;
        }
    }

    addLog(`Creation: ${data.type_certificat} pour ${data.prenom} ${data.nom_famille}`, 'info');

    try {
        // 1. Search or create contact
        addLog('Recherche du contact dans Bexio...', 'info');
        const searchName = data.type_contact === 'Prive' ? data.nom_famille : data.nom_entreprise;
        let contacts = await searchContact(searchName);
        let contactId;

        if (contacts.length > 0) {
            contactId = contacts[0].id;
            addLog(`Contact existant trouve: ID ${contactId} — mise a jour...`, 'info');
            await updateContact(contactId, data);
            addLog(`Contact mis a jour: ID ${contactId}`, 'success');
        } else {
            addLog('Creation du contact...', 'info');
            const newContact = await createContact(data);
            contactId = newContact.id;
            addLog(`Contact cree: ID ${contactId}`, 'success');
        }

        // 2. Create quote
        addLog('Creation de l\'offre Bexio...', 'info');
        const quote = await createBexioQuote(data, contactId);
        addLog(`Offre creee: #${quote.document_nr} (ID: ${quote.id})`, 'success');

        // 3. Save to history
        const pricing = calculatePricing();
        const session = typeof getSession === 'function' ? getSession() : null;
        saveSubmission({
            date: new Date().toISOString(),
            type: data.type_certificat,
            client: data.type_contact === 'Prive' ? (data.prenom + ' ' + data.nom_famille) : data.nom_entreprise,
            address: (data.rue_batiment || data.rue_facturation) + ', ' + (data.npa_batiment || data.npa_facturation) + ' ' + (data.localite_batiment || data.localite_facturation),
            total: pricing.total,
            quoteNr: quote.document_nr || '',
            quoteId: quote.id || '',
            contactId: contactId,
            user: session ? session.email : '',
            formData: data
        });
        addLog('Soumission enregistree dans l\'historique', 'success');

        // 4. Clear temp tarifs after successful submission
        if (tempTarifs) {
            tempTarifs = null;
            loadTarifs();
            renderTarifGrid();
            updatePricePreview();
            addLog('Tarifs temporaires expires (retour aux tarifs permanents)', 'info');
        }

        // Show success
        submitBtn.textContent = 'Devis cree !';
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Creer le devis';
        }, 3000);

    } catch (err) {
        addLog(`Erreur: ${err.message}`, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Creer le devis';
    }
}

// ==========================================
// FORM INTERACTIONS
// ==========================================
function setupFormListeners() {
    // Type contact toggle
    document.getElementById('type_contact').addEventListener('change', function () {
        const grp = document.getElementById('group_nom_entreprise');
        const inp = document.getElementById('nom_entreprise');
        if (this.value === 'Societe') {
            grp.classList.remove('hidden');
            inp.required = true;
        } else {
            grp.classList.add('hidden');
            inp.required = false;
        }
    });

    // Address identical checkbox
    document.getElementById('adresse_identique').addEventListener('change', function () {
        const fields = document.getElementById('adresse_batiment_fields');
        if (this.checked) {
            fields.classList.add('hidden');
            ['rue_batiment', 'npa_batiment', 'localite_batiment'].forEach(id => {
                document.getElementById(id).required = false;
            });
            // Copy values
            document.getElementById('rue_batiment').value = document.getElementById('rue_facturation').value;
            document.getElementById('npa_batiment').value = document.getElementById('npa_facturation').value;
            document.getElementById('localite_batiment').value = document.getElementById('localite_facturation').value;

            const rue = document.getElementById('rue_batiment').value;
            const npa = document.getElementById('npa_batiment').value;
            const loc = document.getElementById('localite_batiment').value;
            if (rue && npa && loc) fetchBuildingData(rue, npa, loc);
        } else {
            fields.classList.remove('hidden');
            ['rue_batiment', 'npa_batiment', 'localite_batiment'].forEach(id => {
                document.getElementById(id).required = true;
            });
        }
    });

    // Certificate type → toggle delai + rabais + subvention
    document.getElementById('type_certificat').addEventListener('change', function () {
        const delaiGrp = document.getElementById('group_delai');
        const rabaisGrp = document.getElementById('rabaisGroup');
        const subvGrp = document.getElementById('subventionGroup');
        if (this.value === 'Conseil Incitatif') {
            delaiGrp.classList.add('hidden');
        } else {
            delaiGrp.classList.remove('hidden');
        }
        if (rabaisGrp) {
            rabaisGrp.style.display = (this.value === 'Transfert CECB' || this.value === 'CECB Plus Transfert') ? '' : 'none';
        }
        if (subvGrp) {
            subvGrp.style.display = (this.value === 'CECB Plus' || this.value === 'CECB Plus Transfert') ? '' : 'none';
        }
        updatePricePreview();
    });

    // Rabais input → update price
    const rabaisInput = document.getElementById('rabais_transfert');
    if (rabaisInput) {
        rabaisInput.addEventListener('input', updatePricePreview);
    }

    // Subvention checkbox → update price
    const subvInput = document.getElementById('inclure_subvention');
    if (subvInput) {
        subvInput.addEventListener('change', updatePricePreview);
    }

    // Price-affecting fields
    ['nombre_etages', 'sous_sol', 'combles', 'delai', 'type_certificat'].forEach(id => {
        document.getElementById(id).addEventListener('change', updatePricePreview);
    });
    document.getElementById('nombre_etages').addEventListener('input', updatePricePreview);

    // Form submit
    document.getElementById('devisForm').addEventListener('submit', handleSubmit);
}

function resetForm() {
    document.getElementById('devisForm').reset();
    buildingData = null;
    cachedDistanceKm = 0;
    distanceFetchFailed = false;
    document.getElementById('buildingData').innerHTML = '<div class="price-placeholder">En attente de l\'adresse du batiment...</div>';
    document.getElementById('pricePreview').innerHTML = '<div class="price-placeholder">Remplissez le formulaire pour voir l\'apercu...</div>';
    document.getElementById('adresse_batiment_fields').classList.remove('hidden');
    document.getElementById('group_nom_entreprise').classList.add('hidden');
    document.getElementById('group_delai').classList.remove('hidden');
    addLog('Formulaire reinitialise', 'info');
}

// ==========================================
// URL PREFILL
// ==========================================
function prefillFromURL() {
    const params = new URLSearchParams(window.location.search);
    let count = 0;
    params.forEach((val, key) => {
        const field = document.getElementById(key);
        if (field) {
            field.value = decodeURIComponent(val);
            if (field.tagName === 'SELECT') field.dispatchEvent(new Event('change'));
            count++;
        }
    });
    if (count > 0) addLog(`${count} champ(s) pre-rempli(s) depuis l'URL`, 'success');
}

// ==========================================
// INIT
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    loadTarifs();
    loadConfig();
    renderTarifGrid();
    renderTarifHistory();
    renderDraftsList();
    setupAutocomplete('rue_facturation', 'sugFacturation', 'facturation');
    setupAutocomplete('rue_batiment', 'sugBatiment', 'batiment');
    setupFormListeners();
    prefillFromURL();
    updatePricePreview();

    // Navigation
    document.querySelectorAll('.main-nav a[data-view]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            switchView(a.dataset.view);
        });
    });

    // Health check — verifier que le serveur proxy est actif
    fetch('/api/health').then(r => r.json()).then(d => {
        if (d.status === 'ok') {
            addLog('Serveur proxy connecte' + (d.bexio_token ? ' (token Bexio OK)' : ' (ATTENTION: token Bexio manquant)'), d.bexio_token ? 'success' : 'error');
        }
    }).catch(() => {
        addLog('ERREUR: Le serveur local ne repond pas. Verifiez que server.py est lance.', 'error');
    });

    addLog('Application initialisee', 'success');
});
