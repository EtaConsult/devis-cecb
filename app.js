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
    surface_factor_petit: 0.6,
    surface_factor_grand: 0.5,
    surface_seuil: 750,
    plus_factor_petit: 3.69,
    plus_factor_moyen: 2.29,
    plus_factor_grand: 1.79,
    plus_seuil_petit: 160,
    plus_seuil_grand: 750,
    plus_price_max: 1989,
    frais_emission_cecb: 80,
    frais_maj_transfert_cecb: 30,
    prix_conseil_incitatif: 0,
    forfait_normal: 0,
    forfait_express: 135,
    forfait_urgent: 270,
    pct_acompte: 30
};

const BEXIO_IDS = {
    user_id: 1,
    mwst_type: 0,
    currency_id: 1,
    language_id: 4,
    article_cecb: 4,
    article_cecb_plus: 11,
    article_frais_emission: 15,
    article_forfait_execution: 12,
    article_conseil_incitatif: 16,
    tax_id: 16
};

const ETA_CONSULT_COORDS = { lat: 46.4571, lon: 6.3375 };
const BEXIO_BASE_URL = 'https://api.bexio.com';

// State
let buildingData = null;
let searchTimeout = null;
let currentView = 'form';

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
        value: 'Prestations incluses :\n- Visite sur site et releves\n- Analyse documentaire\n- Calcul de la SRE\n- Analyse des surfaces d\'enveloppe\n- Estimation des valeurs U\n- Identification des ponts thermiques\n- Certification CECB pour l\'etat actuel'
    },
    prestations_incluses_cecb_plus: {
        label: 'Prestations incluses — CECB Plus',
        value: 'Prestations incluses :\n- Visite sur site et releves\n- Analyse documentaire\n- Calcul de la SRE\n- Analyse des surfaces d\'enveloppe\n- Estimation des valeurs U\n- Identification des ponts thermiques\n- Certification CECB pour l\'etat actuel\n- Rapport CECB Plus avec variantes de renovation chiffrees'
    },
    prestations_incluses_conseil: {
        label: 'Prestations incluses — Conseil Incitatif',
        value: 'Prestations incluses :\n- Conseil personnalise sur les solutions de chauffage renouvelable\n- Visite sur site\n- Etablissement de la checklist Chauffez Renouvelable\n- Recommandations adaptees a votre batiment'
    },
    responsabilite_cecb: {
        label: 'Clause de responsabilite CECB',
        value: 'Informations importantes et clause de non-responsabilite :\nLes classes CECB sont basees sur une methode standardisee et simplifiee d\'estimation des besoins energetiques des batiments. La valeur determinee sert uniquement d\'indication a des fins de comparaison. Toute responsabilite decoulant des declarations du CECB est exclue (chapitre 11.1 du reglement d\'utilisation).'
    },
    footer_conditions: {
        label: 'Footer — Conditions de paiement',
        value: 'Conditions de paiement : Acompte de {pct_acompte}% a la commande, solde a reception du rapport.'
    },
    footer_source: {
        label: 'Footer — Source',
        value: 'Source : Devis CECB — Eta Consult Sarl'
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
    const token = document.getElementById('bexioToken').value;
    const gkey = document.getElementById('googleKey').value;
    if (token) localStorage.setItem('bexio_token', token);
    if (gkey) localStorage.setItem('google_key', gkey);
    document.getElementById('configStatus').textContent = 'Sauvegarde !';
    setTimeout(() => document.getElementById('configStatus').textContent = '', 2000);
    addLog('Configuration sauvegardee', 'success');
}

function loadConfig() {
    const token = localStorage.getItem('bexio_token');
    const gkey = localStorage.getItem('google_key');
    if (token) document.getElementById('bexioToken').value = token;
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
    frais_maj_transfert_cecb: { label: 'Frais MAJ apres transfert', unit: 'CHF' },
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

    for (const [key, val] of Object.entries(TARIFS)) {
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
}

function saveTarifs() {
    const inputs = document.querySelectorAll('#tarifGrid input');
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        const val = parseFloat(inp.value);
        if (!isNaN(val)) TARIFS[key] = val;
    });
    localStorage.setItem('devis_tarifs', JSON.stringify(TARIFS));
    document.getElementById('tarifStatus').textContent = 'Tarifs sauvegardes !';
    setTimeout(() => document.getElementById('tarifStatus').textContent = '', 2000);
    updatePricePreview();
    addLog('Tarifs mis a jour', 'success');
}

function resetTarifs() {
    localStorage.removeItem('devis_tarifs');
    // Reset to defaults
    Object.assign(TARIFS, {
        base_price: 500, km_factor_proche: 0.9, km_factor_loin: 0.7, km_seuil: 25,
        surface_factor_petit: 0.6, surface_factor_grand: 0.5, surface_seuil: 750,
        plus_factor_petit: 3.69, plus_factor_moyen: 2.29, plus_factor_grand: 1.79,
        plus_seuil_petit: 160, plus_seuil_grand: 750, plus_price_max: 1989,
        frais_emission_cecb: 80, frais_maj_transfert_cecb: 30, prix_conseil_incitatif: 0,
        forfait_normal: 0, forfait_express: 135, forfait_urgent: 270, pct_acompte: 30
    });
    renderTarifGrid();
    updatePricePreview();
    document.getElementById('tarifStatus').textContent = 'Tarifs reinitialises';
    setTimeout(() => document.getElementById('tarifStatus').textContent = '', 2000);
    addLog('Tarifs reinitialises aux valeurs par defaut', 'info');
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
    if (delai.includes('Express')) return TARIFS.forfait_express;
    if (delai.includes('Urgent')) return TARIFS.forfait_urgent;
    return TARIFS.forfait_normal;
}

function calculatePricing() {
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

    // Distance (0 by default without Google API)
    const distKm = 0;

    // CECB price
    const kmFactor = distKm < TARIFS.km_seuil ? TARIFS.km_factor_proche : TARIFS.km_factor_loin;
    const surfFactor = sEq < TARIFS.surface_seuil ? TARIFS.surface_factor_petit : TARIFS.surface_factor_grand;
    const cecbPrice = Math.round(TARIFS.base_price + (distKm * kmFactor) + (sEq * surfFactor));

    const lines = [];
    lines.push({ label: `CECB (Seq: ${Math.round(sEq)} m2)`, value: `${cecbPrice} CHF` });
    lines.push({ label: 'Frais emission CECB', value: `${TARIFS.frais_emission_cecb} CHF` });
    lines.push({ label: 'Mise a jour apres transfert', value: `${TARIFS.frais_maj_transfert_cecb} CHF` });

    let total = cecbPrice + TARIFS.frais_emission_cecb + TARIFS.frais_maj_transfert_cecb;

    // CECB Plus
    if (type === 'CECB Plus') {
        let plusFactor;
        if (sEq < TARIFS.plus_seuil_petit) plusFactor = TARIFS.plus_factor_petit;
        else if (sEq < TARIFS.plus_seuil_grand) plusFactor = TARIFS.plus_factor_moyen;
        else plusFactor = TARIFS.plus_factor_grand;

        const plusPrice = Math.min(TARIFS.plus_price_max, Math.round(cecbPrice * plusFactor));
        lines.push({ label: `CECB Plus (x${plusFactor})`, value: `${plusPrice} CHF` });
        total += plusPrice;
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

    let html = `<div style="margin-bottom:8px"><span class="price-badge ${badgeClass}">${pricing.type}</span></div>`;
    pricing.lines.forEach(l => {
        html += `<div class="price-line"><span class="price-label">${l.label}</span><span class="price-value">${l.value}</span></div>`;
    });
    html += `<div class="price-total"><span>Total HT</span><span>${pricing.total} CHF</span></div>`;

    if (!buildingData || !buildingData.garea) {
        html += `<div style="margin-top:8px;font-size:12px;color:#D97706">Surface inconnue — prix indicatif (base uniquement)</div>`;
    }

    el.innerHTML = html;
}

// ==========================================
// BEXIO API
// ==========================================
async function bexioRequest(method, endpoint, body = null) {
    const token = localStorage.getItem('bexio_token');
    if (!token) throw new Error('Token Bexio manquant. Configurez-le dans le panneau en haut.');

    const opts = {
        method,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BEXIO_BASE_URL}${endpoint}`, opts);
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

async function createContact(formData) {
    const isPrive = formData.type_contact === 'Prive';
    const payload = {
        contact_type_id: isPrive ? 1 : 2,
        name_1: isPrive ? formData.nom_famille : formData.nom_entreprise,
        name_2: isPrive ? formData.prenom : '',
        address: formData.rue_facturation,
        postcode: formData.npa_facturation,
        city: formData.localite_facturation,
        country_id: 1, // Switzerland
        mail: formData.email,
        phone_fixed: formData.telephone || '',
        user_id: BEXIO_IDS.user_id,
        owner_id: BEXIO_IDS.user_id
    };

    if (isPrive) {
        const salutMap = { 'Mme': 1, 'M.': 2 };
        if (salutMap[formData.appellation]) {
            payload.salutation_id = salutMap[formData.appellation];
        }
    }

    return bexioRequest('POST', '/2.0/contact', payload);
}

async function createBexioQuote(formData, contactId) {
    const type = formData.type_certificat;
    const adresse = formData.rue_batiment || formData.rue_facturation;
    const npa = formData.npa_batiment || formData.npa_facturation;
    const loc = formData.localite_batiment || formData.localite_facturation;
    const title = `${type} - ${adresse}, ${npa}, ${loc}`;

    const positions = buildPositions(formData, type);
    const footerCond = getText('footer_conditions').replace('{pct_acompte}', TARIFS.pct_acompte);
    const footerSrc = getText('footer_source');
    const footer = footerCond + '<br><br>' + footerSrc;

    const payload = {
        contact_id: contactId,
        user_id: BEXIO_IDS.user_id,
        title,
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
            type: 'KbPositionArticle',
            article_id: BEXIO_IDS.article_conseil_incitatif,
            amount: '1',
            unit_price: '0',
            tax_id: BEXIO_IDS.tax_id,
            text: `Conseil incitatif Chauffez renouvelable:\n- EGID n${bd.egid || '—'}\n- ${adresse}, ${npa} ${loc}`
        });
        // Prestations text
        positions.push({
            type: 'KbPositionText',
            text: getText('prestations_incluses_conseil')
        });
        // Message du prospect (si fourni)
        const msgCI = (formData.message || '').trim();
        if (msgCI) {
            positions.push({
                type: 'KbPositionText',
                text: `Message :\n${msgCI}`
            });
        }
        return positions;
    }

    // CECB position
    const pricing = calculatePricing();
    const cecbPrice = pricing.lines[0] ? parseInt(pricing.lines[0].value) || 0 : 0;

    positions.push({
        type: 'KbPositionArticle',
        article_id: BEXIO_IDS.article_cecb,
        amount: '1',
        unit_price: String(cecbPrice),
        tax_id: BEXIO_IDS.tax_id,
        text: `Etablissement d'un certificat CECB:\n- EGID n${bd.egid || '—'}\n- ${adresse}, ${npa} ${loc}\n- ${bd.gastw || 2} niveaux hors sol\n- Surface au sol ${bd.garea || '?'} m2\n- Annee de construction : ${bd.gbauj || '?'}`
    });

    // Frais emission
    positions.push({
        type: 'KbPositionArticle',
        article_id: BEXIO_IDS.article_frais_emission,
        amount: '1',
        unit_price: String(TARIFS.frais_emission_cecb),
        tax_id: BEXIO_IDS.tax_id,
        text: 'Frais d\'emission du rapport CECB sur la plateforme (tarifs 2026)'
    });

    // Frais mise a jour apres transfert
    positions.push({
        type: 'KbPositionCustom',
        amount: '1',
        unit_price: String(TARIFS.frais_maj_transfert_cecb),
        tax_id: BEXIO_IDS.tax_id,
        text: 'Frais de mise a jour du CECB apres transfert'
    });

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
            text: `Etablissement d'un certificat CECB Plus, en sus:\n- ${adresse}, ${npa} ${loc}`
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
            text: `Forfait execution ${delaiLabel}`
        });
    }

    // Prestations text
    const prestationsKey = type === 'CECB Plus' ? 'prestations_incluses_cecb_plus' : 'prestations_incluses_cecb';
    positions.push({
        type: 'KbPositionText',
        text: getText(prestationsKey)
    });

    // Responsabilite text
    positions.push({
        type: 'KbPositionText',
        text: getText('responsabilite_cecb')
    });

    // Message du prospect (si fourni)
    const message = (formData.message || '').trim();
    if (message) {
        positions.push({
            type: 'KbPositionText',
            text: `Message :\n${message}`
        });
    }

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

    addLog(`Creation: ${data.type_certificat} pour ${data.prenom} ${data.nom_famille}`, 'info');

    try {
        // 1. Search or create contact
        addLog('Recherche du contact dans Bexio...', 'info');
        const searchName = data.type_contact === 'Prive' ? data.nom_famille : data.nom_entreprise;
        let contacts = await searchContact(searchName);
        let contactId;

        if (contacts.length > 0) {
            contactId = contacts[0].id;
            addLog(`Contact existant trouve: ID ${contactId}`, 'success');
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

    // Certificate type → toggle delai
    document.getElementById('type_certificat').addEventListener('change', function () {
        const delaiGrp = document.getElementById('group_delai');
        if (this.value === 'Conseil Incitatif') {
            delaiGrp.classList.add('hidden');
        } else {
            delaiGrp.classList.remove('hidden');
        }
        updatePricePreview();
    });

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

    addLog('Application initialisee', 'success');
});
