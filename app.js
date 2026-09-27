'use strict';

// ---------- Kern-Logik ----------
function parseIP(str) {
    if (typeof str !== 'string') return {valid: false, error: 'Keine Eingabe.'};
    const t = str.trim();
    if (t === '') return {valid: false, error: 'Bitte eine IPv4-Adresse eingeben.'};
    const parts = t.split('.');
    if (parts.length !== 4) return {valid: false, error: 'Ungültig, weil vier Oktette benötigt werden (z. B. 192.168.1.1).'};
    const octets = [];
    for (const p of parts) {
        if (!/^\d+$/.test(p)) return {valid: false, error: `Ungültiges Zeichen in "${p}" — nur Ziffern erlaubt.`};
        const n = parseInt(p, 10);
        if (n > 255) return {valid: false, error: `Ungültig, weil ein IPv4-Oktett maximal 255 sein darf (gefunden: ${n}).`};
        octets.push(n);
    }
    return {valid: true, octets};
}
function ipToInt(o) {return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;}
function intToIp(n) {return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');}
function cidrToMaskInt(c) {return c === 0 ? 0 : (0xFFFFFFFF << (32 - c)) >>> 0;}
function maskStr(c) {return intToIp(cidrToMaskInt(c));}
function toBin8(n) {return n.toString(2).padStart(8, '0');}
function subnetInfo(ipInt, cidr) {
    const maskInt = cidrToMaskInt(cidr);
    const network = (ipInt & maskInt) >>> 0;
    const hostBits = 32 - cidr;
    const broadcast = (network | (~maskInt >>> 0)) >>> 0;
    const total = Math.pow(2, hostBits);
    let firstHost, lastHost, usable;
    if (cidr >= 31) {firstHost = network; lastHost = broadcast; usable = cidr === 32 ? 1 : 2;}
    else {firstHost = network + 1; lastHost = broadcast - 1; usable = total - 2;}
    return {maskInt, network, broadcast, firstHost, lastHost, total, usable, hostBits};
}
// "Interessantes" Oktett: dort liegt das letzte Netzwerkbit; Blockgröße = 256 - Maskenwert
function magicInfo(cidr) {
    if (cidr === 0) return null;
    const oct = Math.floor((cidr - 1) / 8);
    const maskOct = (cidrToMaskInt(cidr) >>> (24 - 8 * oct)) & 255;
    return {oct, maskOct, block: 256 - maskOct};
}
function addrType(ipInt) {
    const a = ipInt >>> 24, b = (ipInt >>> 16) & 255;
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'Privat (RFC 1918)';
    if (a === 127) return 'Loopback';
    if (a === 169 && b === 254) return 'Link-Local (APIPA)';
    if (a === 100 && b >= 64 && b <= 127) return 'Carrier-Grade NAT';
    if (a === 0) return '„Dieses Netz“ (0/8)';
    if (a >= 224 && a <= 239) return 'Multicast (Klasse D)';
    if (a >= 240) return ipInt === 0xFFFFFFFF ? 'Limited Broadcast' : 'Reserviert (Klasse E)';
    return 'Öffentlich';
}
const fmt = n => n.toLocaleString('de-DE');
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function randInt(a, b) {return Math.floor(Math.random() * (b - a + 1)) + a;}
function shuffle(arr) {for (let i = arr.length - 1; i > 0; i--) {const j = randInt(0, i); [arr[i], arr[j]] = [arr[j], arr[i]];} return arr;}
function randomPrivateIp() {
    const r = randInt(0, 2);
    if (r === 0) return ipToInt([10, randInt(0, 255), randInt(0, 255), randInt(0, 255)]);
    if (r === 1) return ipToInt([172, randInt(16, 31), randInt(0, 255), randInt(0, 255)]);
    return ipToInt([192, 168, randInt(0, 255), randInt(0, 255)]);
}

// ---------- UI-Helfer ----------
function setVal(el, v) {el.value = v; el.dispatchEvent(new Event('input', {bubbles: true}));}
function markValid(el, ok) {el.classList.toggle('invalid', !ok); el.setAttribute('aria-invalid', String(!ok));}
function readCidr(el) {
    const t = el.value.trim();
    if (!/^\d+$/.test(t)) return null;
    const c = parseInt(t, 10), min = +el.min, max = +el.max;
    return c >= min && c <= max ? c : null;
}
function readIp(el) {const r = parseIP(el.value); markValid(el, r.valid); return r;}
function readPrefix(el) {const c = readCidr(el); markValid(el, c !== null); return c;}

let toastTimer;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}
async function copyText(txt) {
    try {await navigator.clipboard.writeText(txt); toast(`„${txt}“ kopiert`);}
    catch {toast('Kopieren nicht möglich');}
}
function goTo(id) {$(id).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});}

// IP-Felder: ↑/↓ ändert das Oktett unter dem Cursor
document.querySelectorAll('input.ip').forEach(el => {
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('spellcheck', 'false');
    el.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const r = parseIP(el.value);
        if (!r.valid) return;
        e.preventDefault();
        const pos = el.selectionStart ?? el.value.length;
        const idx = clamp(el.value.slice(0, pos).split('.').length - 1, 0, 3);
        const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
        r.octets[idx] = clamp(r.octets[idx] + step, 0, 255);
        setVal(el, r.octets.join('.'));
        const caret = r.octets.slice(0, idx + 1).join('.').length;
        el.setSelectionRange(caret, caret);
    });
});

// Stepper-Buttons (− / +) und Slider-Synchronisation
document.querySelectorAll('.stepper').forEach(st => {
    const inp = st.querySelector('input');
    st.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
        let v = parseInt(inp.value, 10);
        if (isNaN(v)) v = parseInt(inp.defaultValue, 10) || +inp.min;
        setVal(inp, clamp(v + +b.dataset.step, +inp.min, +inp.max));
    }));
});
document.querySelectorAll('input[type=range][data-sync]').forEach(r => {
    const num = $(r.dataset.sync);
    r.addEventListener('input', () => {if (num.value !== r.value) setVal(num, r.value);});
    num.addEventListener('input', () => {const v = parseInt(num.value, 10); if (!isNaN(v)) r.value = v;});
});

// Segmented Controls
function segControl(el, onChange) {
    const btns = [...el.querySelectorAll('button')];
    btns.forEach(b => b.addEventListener('click', () => {
        btns.forEach(x => x.setAttribute('aria-checked', String(x === b)));
        onChange(b.dataset.mode);
    }));
    return () => btns.find(b => b.getAttribute('aria-checked') === 'true').dataset.mode;
}

// Bit-Tabelle: 4 Oktett-Blöcke, jeweils mehrere Zeilen à 8 Bit
function octetTable(rows) {
    let h = '';
    for (let o = 0; o < 4; o++) {
        h += `<div class="oct"><div class="oct-h">Oktett ${o + 1}</div>`;
        for (const r of rows) {
            h += `<div class="brow"><span class="rl" title="${r.title || ''}">${r.label}</span><span class="bits8">`;
            for (let j = 0; j < 8; j++) {
                const i = o * 8 + j, bit = (r.value >>> (31 - i)) & 1, cls = r.cls(i, bit);
                h += r.kind
                    ? `<button type="button" tabindex="-1" class="bit ${cls}" data-kind="${r.kind}" data-i="${i}" aria-label="Bit ${i + 1}">${bit}</button>`
                    : `<span class="bit ${cls}">${bit}</span>`;
            }
            h += `</span><span class="dv">${(r.value >>> (24 - 8 * o)) & 255}</span></div>`;
        }
        h += '</div>';
    }
    return h;
}
const edge = (i, cidr) => (i === cidr - 1 && cidr < 32 ? ' edge' : '');

// ---------- Navigation: Scrollspy ----------
(function () {
    const nav = $('nav'), links = [...nav.querySelectorAll('a')];
    const byId = Object.fromEntries(links.map(a => [a.getAttribute('href').slice(1), a]));
    let current = null;
    const obs = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            const a = byId[e.target.id];
            if (!a || a === current) continue;
            current?.classList.remove('active'); current?.removeAttribute('aria-current');
            a.classList.add('active'); a.setAttribute('aria-current', 'true'); current = a;
            if (nav.scrollWidth > nav.clientWidth + 4) {
                nav.scrollTo({left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: 'smooth'});
            }
        }
    }, {rootMargin: '-40% 0px -55% 0px'});
    Object.keys(byId).forEach(id => $(id) && obs.observe($(id)));
})();

// ---------- 01 Adressraum-Visualisierer ----------
// Jedes Oktett als 16x16-Raster (256 Werte). Pro Oktett: wie viele der 8 Bit fixiert das Präfix?
//   alle 8 fest -> genau 1 Wert (exact) · keins fest -> alles frei · teils fest -> Block um den Ist-Wert (range)
const viz = (function () {
    const vip = $('vip'), vcidr = $('vcidr'), grids = $('vgrids'), vexplain = $('vexplain');
    const cells = [[], [], [], []], heads = [], bigs = [], reads = [];
    let state = null;
    for (let o = 0; o < 4; o++) {
        const wrap = document.createElement('div'); wrap.className = 'octblock';
        wrap.innerHTML = `<div class="octbig">—</div><h4></h4><div class="octgrid" role="group" aria-label="Werte von Oktett ${o + 1}"></div><div class="octread"></div>`;
        const grid = wrap.querySelector('.octgrid');
        for (let v = 0; v < 256; v++) {const c = document.createElement('div'); c.dataset.v = v; grid.appendChild(c); cells[o].push(c);}
        bigs.push(wrap.querySelector('.octbig')); heads.push(wrap.querySelector('h4')); reads.push(wrap.querySelector('.octread'));
        grid.addEventListener('pointerover', e => {const v = e.target.dataset.v; if (v !== undefined) showRead(o, +v);});
        grid.addEventListener('pointerleave', () => showRead(o, null));
        grid.addEventListener('click', e => {
            const v = e.target.dataset.v;
            if (v === undefined || !state) return;
            const oct = [...state.octets]; oct[o] = +v;
            setVal(vip, oct.join('.'));
        });
        grids.appendChild(wrap);
    }
    function showRead(o, v) {
        if (!state) {reads[o].textContent = ''; return;}
        const val = v === null ? state.octets[o] : v;
        const inNet = cells[o][val].classList.contains('exact') || cells[o][val].classList.contains('range') || cells[o][val].classList.contains('free');
        reads[o].innerHTML = `<b>${val}</b> = <code>${toBin8(val)}</code>${v === null ? '' : inNet ? ' · im Netz' : ' · anderes Netz'}`;
    }
    function render() {
        const res = readIp(vip), cidr = readPrefix(vcidr);
        if (!res.valid || cidr === null) {state = null; vexplain.textContent = res.valid ? 'Präfix muss zwischen /0 und /32 liegen.' : res.error; vexplain.className = 'explain bad'; return;}
        vexplain.className = 'explain';
        state = {octets: res.octets, cidr};
        const ipInt = ipToInt(res.octets), info = subnetInfo(ipInt, cidr), parts = [];
        for (let o = 0; o < 4; o++) {
            const start = o * 8, val = res.octets[o], cs = cells[o];
            const k = clamp(cidr - start, 0, 8);
            bigs[o].textContent = val;
            heads[o].textContent = `Oktett ${o + 1} · ${k}/8 Bit fest`;
            if (k === 0) {
                for (let v = 0; v < 256; v++) cs[v].className = v === val ? 'free cur' : 'free';
                parts.push(`<li><b>Oktett ${o + 1}</b>: frei — alle 256 Werte gehören zum Netz</li>`);
            } else if (k === 8) {
                for (let v = 0; v < 256; v++) cs[v].className = v === val ? 'exact cur' : '';
                parts.push(`<li><b>Oktett ${o + 1}</b>: fest auf ${val}</li>`);
            } else {
                const size = 256 >> k, bs = Math.floor(val / size) * size;
                for (let v = 0; v < 256; v++) cs[v].className = (v >= bs && v < bs + size ? 'range' : '') + (v === val ? ' cur' : '');
                parts.push(`<li><b>Oktett ${o + 1}</b>: ${k} Bit fest, ${8 - k} frei → Bereich ${bs}–${bs + size - 1} (Blockgröße ${size})</li>`);
            }
            showRead(o, null);
        }
        vexplain.innerHTML = `<b>${intToIp(ipInt)}/${cidr}</b> → Netz <b>${intToIp(info.network)}</b>, Broadcast <b>${intToIp(info.broadcast)}</b>, <b>${fmt(info.usable)}</b> nutzbare Hosts.<ul class="parts">${parts.join('')}</ul>`;
    }
    [vip, vcidr].forEach(el => el.addEventListener('input', render));
    const presets = [
        {ip: '192.168.0.1', cidr: 24}, {ip: '192.168.50.1', cidr: 25}, {ip: '192.168.10.50', cidr: 27},
        {ip: '10.0.0.1', cidr: 8}, {ip: '172.16.5.10', cidr: 12}, {ip: '10.20.30.40', cidr: 22}
    ];
    const vp = $('vpresets');
    vp.innerHTML = presets.map(p => `<button type="button" class="chip" data-ip="${p.ip}" data-cidr="${p.cidr}">${p.ip}/${p.cidr}</button>`).join('');
    vp.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        vip.value = b.dataset.ip; setVal(vcidr, b.dataset.cidr);
    });
    return {render};
})();

// ---------- 02 Subnetz-Rechner ----------
const calc = (function () {
    const ip = $('s1ip'), cidrEl = $('s1cidr'), err = $('s1error'), bitsEl = $('s1bits'), resEl = $('s1res'), explain = $('s1explain');
    const prev = $('s1prev'), next = $('s1next');
    let state = null;
    function render() {
        const r = readIp(ip), cidr = readPrefix(cidrEl);
        if (!r.valid || cidr === null) {
            err.textContent = r.valid ? 'Präfix muss zwischen /0 und /32 liegen.' : r.error;
            state = null; prev.disabled = next.disabled = true; return;
        }
        err.textContent = '';
        const ipInt = ipToInt(r.octets), info = subnetInfo(ipInt, cidr);
        state = {ipInt, cidr, info};
        prev.disabled = cidr === 0 || info.network === 0;
        next.disabled = cidr === 0 || info.broadcast === 0xFFFFFFFF;
        bitsEl.innerHTML = octetTable([
            {label: 'IP', title: 'IP-Adresse (Bit anklicken zum Umschalten)', value: ipInt, kind: 'ip', cls: (i) => (i < cidr ? 'net' : 'host') + edge(i, cidr)},
            {label: 'M', title: 'Subnetzmaske (anklicken verschiebt das Präfix)', value: info.maskInt, kind: 'mask', cls: (i, b) => (b ? 'm1' : 'm0') + edge(i, cidr)},
            {label: 'N', title: 'Netzwerkadresse = IP AND Maske', value: info.network, cls: (i) => (i < cidr ? 'net' : 'zero') + edge(i, cidr)}
        ]);
        const wild = intToIp(~info.maskInt >>> 0);
        const items = [
            ['Netzwerkadresse', `${intToIp(info.network)}/${cidr}`],
            ['Subnetzmaske', maskStr(cidr)],
            ['Broadcast-Adresse', intToIp(info.broadcast)],
            ['Wildcard-Maske', wild],
            ['Erster Host', intToIp(info.firstHost)],
            ['Letzter Host', intToIp(info.lastHost)],
            ['Nutzbare Hosts', fmt(info.usable)],
            ['Adressen gesamt', fmt(info.total)],
            ['Host-Bits', String(info.hostBits)],
            ['Adresstyp', addrType(ipInt)]
        ];
        resEl.innerHTML = items.map(([k, v]) => `<button type="button" class="resitem" data-copy="${v}"><span class="k">${k}</span><span class="v">${v}</span></button>`).join('');
        const m = magicInfo(cidr);
        let magic = '';
        if (m && cidr % 8 !== 0) {
            magic = `<br><br><b>Schnellrechnung:</b> Das interessante Oktett ist Oktett ${m.oct + 1} (Maskenwert ${m.maskOct}). Blockgröße = 256 − ${m.maskOct} = <b>${m.block}</b>. Die Netze beginnen dort also bei 0, ${m.block}, ${m.block * 2}, … — ${(ipInt >>> (24 - 8 * m.oct)) & 255} liegt im Block ab ${((info.network >>> (24 - 8 * m.oct)) & 255)}.`;
        } else if (m) {
            magic = `<br><br><b>Schnellrechnung:</b> /${cidr} liegt genau auf einer Oktettgrenze — die ersten ${cidr / 8} Oktett(e) sind fest, der Rest ist frei.`;
        }
        const special = cidr === 31 ? ' Sonderfall /31 (RFC 3021): Punkt-zu-Punkt-Link, beide Adressen sind nutzbar.' : cidr === 32 ? ' Sonderfall /32: eine einzelne Host-Route.' : '';
        explain.innerHTML = `Die ersten <b>${cidr}</b> Bits sind bei jeder Adresse in diesem Netz identisch (Netzwerkbits). Die restlichen <b>${info.hostBits}</b> Bits dürfen variieren — sie unterscheiden die Geräte. Alle Kombinationen ergeben den Bereich ${intToIp(info.network)} bis ${intToIp(info.broadcast)}. Die erste (alle Hostbits 0) ist die Netzwerkadresse, die letzte (alle Hostbits 1) der Broadcast — dazwischen bleiben <b>${fmt(info.usable)}</b> Adressen für Geräte.${special}${magic}`;
    }
    bitsEl.addEventListener('click', e => {
        const b = e.target.closest('.bit[data-kind]'); if (!b || !state) return;
        const i = +b.dataset.i;
        if (b.dataset.kind === 'ip') setVal(ip, intToIp((state.ipInt ^ (1 << (31 - i))) >>> 0));
        else setVal(cidrEl, i < state.cidr ? i : i + 1);
    });
    resEl.addEventListener('click', e => {const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy);});
    function shift(dir) {
        if (!state) return;
        const {ipInt, info} = state;
        setVal(ip, intToIp((ipInt + dir * info.total) >>> 0));
    }
    prev.addEventListener('click', () => shift(-1));
    next.addEventListener('click', () => shift(1));
    $('s1rand').addEventListener('click', () => {ip.value = intToIp(randomPrivateIp()); setVal(cidrEl, randInt(16, 30));});
    [ip, cidrEl].forEach(el => el.addEventListener('input', render));
    function load(ipStr, c) {ip.value = ipStr; setVal(cidrEl, c); goTo('calc');}
    return {render, load};
})();

// ---------- 03 Subnetzmasken-Vergleich ----------
// Ein Basis-Präfix definiert einen Block. Jede weitere Stufe teilt ihn in 2^(c-basis) gleich große Subnetze.
const cmp = (function () {
    const ip = $('cmpip'), base = $('cmpbase'), rows = $('cmprows'), infoEl = $('cmpinfo');
    const DEPTH = 7;
    let state = null;
    function render() {
        const r = readIp(ip), baseCidr = readPrefix(base);
        if (!r.valid || baseCidr === null) {rows.innerHTML = ''; infoEl.innerHTML = `<span class="error">${r.valid ? 'Präfix ungültig.' : r.error}</span>`; state = null; return;}
        const ipInt = ipToInt(r.octets);
        const baseNet = (ipInt & cidrToMaskInt(baseCidr)) >>> 0;
        const blockTotal = Math.pow(2, 32 - baseCidr);
        const last = Math.min(32, baseCidr + DEPTH - 1);
        state = {ipInt, baseNet, baseCidr, blockTotal};
        let h = '';
        for (let c = baseCidr; c <= last; c++) {
            const n = Math.pow(2, c - baseCidr), size = blockTotal / n;
            const idx = Math.floor((ipInt - baseNet) / size);
            let segs = '';
            for (let i = 0; i < n; i++) {
                const s = baseNet + i * size;
                segs += `<div class="cmp-seg${i === idx ? ' active' : ''}" data-c="${c}" data-i="${i}" title="${intToIp(s)} – ${intToIp(s + size - 1)}"></div>`;
            }
            const aNet = baseNet + idx * size;
            h += `<div class="cmp-row"><div class="cmp-label">/${c}<small>${fmt(n)}× · ${fmt(size)} Adr.</small></div><div class="cmp-bar">${segs}</div><div class="cmp-range">${intToIp(aNet)} – ${intToIp(aNet + size - 1)}</div></div>`;
        }
        rows.innerHTML = h;
        const nLast = Math.pow(2, last - baseCidr);
        const idxLast = Math.floor((ipInt - baseNet) / (blockTotal / nLast));
        infoEl.innerHTML = `Basis: <b>${intToIp(baseNet)}/${baseCidr}</b> — bei /${last} liegt ${intToIp(ipInt)} in Subnetz Nr. <b>${idxLast + 1}</b> von ${fmt(nLast)}. Jede Stufe halbiert die Subnetzgröße und verdoppelt die Anzahl — die Grenzen bleiben erhalten (verschachtelt statt neu verteilt).`;
    }
    rows.addEventListener('click', e => {
        const s = e.target.closest('.cmp-seg'); if (!s || !state) return;
        const {ipInt, baseNet, baseCidr, blockTotal} = state;
        const size = blockTotal / Math.pow(2, +s.dataset.c - baseCidr);
        const offset = (ipInt - baseNet) % size;
        setVal(ip, intToIp(baseNet + +s.dataset.i * size + offset));
    });
    [ip, base].forEach(el => el.addEventListener('input', render));
    return {render};
})();

// ---------- 04 Selbes Netz? ----------
const same = (function () {
    const a = $('s2a'), b = $('s2b'), cidrEl = $('s2cidr'), bits = $('s2bits'), out = $('s2out');
    let state = null;
    function render() {
        const ra = readIp(a), rb = readIp(b), cidr = readPrefix(cidrEl);
        const errs = [];
        if (!ra.valid) errs.push('Gerät A: ' + ra.error);
        if (!rb.valid) errs.push('Gerät B: ' + rb.error);
        if (cidr === null) errs.push('Maske muss zwischen /0 und /32 liegen.');
        if (errs.length) {state = null; bits.innerHTML = ''; out.innerHTML = errs.map(x => `<div class="error">${x}</div>`).join(''); return;}
        const ia = ipToInt(ra.octets), ib = ipToInt(rb.octets);
        const diff = (ia ^ ib) >>> 0, common = Math.clz32(diff);
        state = {ia, ib, common};
        const cls = (i) => {
            const d = (diff >>> (31 - i)) & 1;
            return (i < cidr ? 'net' : 'host') + (d ? (i < cidr ? ' diff' : ' diffh') : '') + edge(i, cidr);
        };
        bits.innerHTML = octetTable([
            {label: 'A', title: 'Gerät A', value: ia, kind: 'a', cls},
            {label: 'B', title: 'Gerät B', value: ib, kind: 'b', cls}
        ]);
        const na = subnetInfo(ia, cidr).network, nb = subnetInfo(ib, cidr).network, ok = na === nb;
        let h = `<div class="results"><div class="resitem"><span class="k">Netz A</span><span class="v">${intToIp(na)}/${cidr}</span></div><div class="resitem"><span class="k">Netz B</span><span class="v">${intToIp(nb)}/${cidr}</span></div></div>`;
        const hint = diff === 0 ? 'Beide Adressen sind identisch — Achtung, das wäre ein IP-Konflikt!'
            : `Die Adressen stimmen in den ersten <b>${common}</b> Bits überein (erstes abweichendes Bit: Nr. ${common + 1}). Mit jedem Präfix bis /${common} landen beide im selben Netz.`;
        h += ok
            ? `<div class="explain good"><span class="badge ok">Gleiches Subnetz</span><br><br>Beide Geräte berechnen dieselbe Netzwerkadresse. A erreicht B direkt über Layer 2 (Switch, ARP) — ohne Router. ${hint}</div>`
            : `<div class="explain bad"><span class="badge bad">Unterschiedliche Subnetze</span><br><br>Mindestens ein Netzwerkbit unterscheidet sich (rot). A schickt das Paket an sein Default Gateway, der Router leitet es weiter. ${hint}</div>`;
        out.innerHTML = h;
    }
    bits.addEventListener('click', e => {
        const t = e.target.closest('.bit[data-kind]'); if (!t || !state) return;
        const i = +t.dataset.i, m = (1 << (31 - i));
        if (t.dataset.kind === 'a') setVal(a, intToIp((state.ia ^ m) >>> 0));
        else setVal(b, intToIp((state.ib ^ m) >>> 0));
    });
    $('s2swap').addEventListener('click', () => {const t = a.value; a.value = b.value; setVal(b, t);});
    $('s2fit').addEventListener('click', () => {if (state) setVal(cidrEl, state.common);});
    [a, b, cidrEl].forEach(el => el.addEventListener('input', render));
    return {render};
})();

// ---------- 05 Konfiguration prüfen ----------
const check = (function () {
    const ip = $('s4ip'), cidrEl = $('s4cidr'), gw = $('s4gw'), list = $('s4list'), line = $('s4line');
    const item = (ok, text) => `<li class="${ok ? 'ok' : 'bad'}"><span class="ic" aria-hidden="true">${ok ? '✓' : '✕'}</span><span>${text}</span></li>`;
    function render() {
        const rip = readIp(ip), rgw = readIp(gw), cidr = readPrefix(cidrEl);
        line.innerHTML = '';
        if (!rip.valid) {list.innerHTML = item(false, 'IP-Adresse: ' + rip.error); return;}
        let h = item(true, 'IP-Adresse ist syntaktisch gültig.');
        if (cidr === null) {list.innerHTML = h + item(false, 'Maske muss zwischen /0 und /32 liegen.'); return;}
        const ipInt = ipToInt(rip.octets), info = subnetInfo(ipInt, cidr);
        const isNet = ipInt === info.network && cidr < 31, isBc = ipInt === info.broadcast && cidr < 31;
        h += item(!isNet, isNet ? `IP ist die Netzwerkadresse (${intToIp(info.network)}) — sie kennzeichnet das Netz selbst und darf keinem Gerät zugewiesen werden.` : 'IP ist keine Netzwerkadresse.');
        h += item(!isBc, isBc ? `IP ist die Broadcast-Adresse (${intToIp(info.broadcast)}) — sie adressiert alle Geräte im Netz gleichzeitig.` : 'IP ist keine Broadcast-Adresse.');
        if (!rgw.valid) {list.innerHTML = h + item(false, 'Gateway: ' + rgw.error); return;}
        const gwInt = ipToInt(rgw.octets);
        const sameNet = subnetInfo(gwInt, cidr).network === info.network;
        h += item(sameNet, sameNet ? `Gateway ${intToIp(gwInt)} liegt im selben Subnetz (${intToIp(info.network)}/${cidr}).` : `Gateway ${intToIp(gwInt)} liegt NICHT im lokalen Subnetz ${intToIp(info.network)}/${cidr} — der Host kann ihn per ARP nicht erreichen.`);
        const gwBad = sameNet && (gwInt === info.network || gwInt === info.broadcast) && cidr < 31;
        h += item(!gwBad && sameNet, gwBad ? 'Gateway ist selbst Netz- oder Broadcast-Adresse und damit keine gültige Host-Adresse.' : sameNet ? 'Gateway ist eine gültige Host-Adresse.' : 'Gateway-Adresse kann nicht verwendet werden.');
        const gwSame = gwInt === ipInt;
        if (gwSame) h += item(false, 'Gateway und Host haben dieselbe IP — Adresskonflikt.');
        const ok = !isNet && !isBc && sameNet && !gwBad && !gwSame;
        h += `<li class="sum"><span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'Gültige Konfiguration' : 'Ungültige / problematische Konfiguration'}</span></li>`;
        list.innerHTML = h;
        // Zahlenstrahl: Position von Host und Gateway im Subnetz
        const pos = x => info.total <= 1 ? 50 : ((x - info.network) / (info.total - 1) * 100);
        let marks = `<span class="nl-m m-ip" style="left:${pos(ipInt)}%" title="Host"></span>`;
        if (sameNet) marks += `<span class="nl-m m-gw" style="left:${pos(gwInt)}%" title="Gateway"></span>`;
        line.innerHTML = `<div class="numline"><div class="nl-bar">${marks}</div><div class="nl-ends"><span>${intToIp(info.network)}</span><span>${intToIp(info.broadcast)}</span></div><div class="legend"><span class="l-net">Host ${intToIp(ipInt)}</span><span class="l-host">Gateway${sameNet ? '' : ' (außerhalb!)'}</span></div></div>`;
    }
    const scenarios = [
        {t: '✓ Korrekt', ip: '192.168.1.50', c: 24, gw: '192.168.1.1'},
        {t: 'Gateway fremd', ip: '192.168.1.50', c: 24, gw: '192.168.2.1'},
        {t: 'Broadcast als IP', ip: '10.0.0.63', c: 26, gw: '10.0.0.1'},
        {t: 'Netzadresse als IP', ip: '172.16.4.0', c: 22, gw: '172.16.4.1'},
        {t: 'Maske zu klein', ip: '192.168.1.130', c: 25, gw: '192.168.1.1'}
    ];
    const pres = $('s4presets');
    pres.innerHTML = scenarios.map((s, i) => `<button type="button" class="chip" data-i="${i}">${s.t}</button>`).join('');
    pres.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const s = scenarios[+b.dataset.i]; ip.value = s.ip; gw.value = s.gw; setVal(cidrEl, s.c);
    });
    [ip, cidrEl, gw].forEach(el => el.addEventListener('input', render));
    return {render};
})();

// ---------- 06 Subnetz-Teiler ----------
const splitter = (function () {
    const ip = $('spip'), cidrEl = $('spcidr'), n = $('spn'), out = $('spout'), lbl = $('spnlbl');
    const SHOW = 64;
    let showAll = false;
    const mode = segControl($('spmode'), m => {
        lbl.textContent = m === 'nets' ? 'Benötigte Netze' : 'Hosts pro Netz';
        setVal(n, m === 'nets' ? 4 : 50);
    });
    function render() {
        const r = readIp(ip), base = readPrefix(cidrEl);
        const want = parseInt(n.value, 10);
        markValid(n, want >= 1);
        if (!r.valid) {out.innerHTML = `<div class="error">${r.error}</div>`; return;}
        if (base === null) {out.innerHTML = '<div class="error">Präfix muss zwischen /0 und /32 liegen.</div>'; return;}
        if (!(want >= 1)) {out.innerHTML = '<div class="error">Bitte eine Zahl ≥ 1 eingeben.</div>'; return;}
        const ipInt = ipToInt(r.octets), baseNet = (ipInt & cidrToMaskInt(base)) >>> 0;
        let newC, why;
        if (mode() === 'nets') {
            const borrow = Math.ceil(Math.log2(want));
            newC = base + borrow;
            why = `${fmt(want)} Netze brauchen ${borrow} geliehene Bit${borrow === 1 ? '' : 's'} (2<sup>${borrow}</sup> = ${fmt(Math.pow(2, borrow))} ≥ ${fmt(want)}).`;
            if (newC > 32) {out.innerHTML = `<div class="error">Ein /${base} lässt sich nicht in ${fmt(want)} Netze teilen — dafür wären ${borrow} Bits nötig, es gibt aber nur ${32 - base} Hostbits.</div>`; return;}
        } else {
            let h = 2; while (Math.pow(2, h) - 2 < want) h++;
            newC = 32 - h;
            why = `${fmt(want)} Hosts brauchen ${h} Hostbits (2<sup>${h}</sup> − 2 = ${fmt(Math.pow(2, h) - 2)} ≥ ${fmt(want)}).`;
            if (newC < base) {out.innerHTML = `<div class="error">${fmt(want)} Hosts passen nicht in ein /${base} — dafür wäre mindestens ein /${newC} nötig.</div>`; return;}
        }
        const count = Math.pow(2, newC - base), size = Math.pow(2, 32 - newC);
        const info0 = subnetInfo(baseNet, newC);
        let h = '';
        if (baseNet !== ipInt) h += `<div class="note">Hinweis: ${intToIp(ipInt)} ist keine Netzadresse — verwendet wird ${intToIp(baseNet)}/${base}.</div>`;
        h += `<div class="results">
            <div class="resitem"><span class="k">Neues Präfix</span><span class="v">/${newC}</span></div>
            <div class="resitem"><span class="k">Neue Maske</span><span class="v">${maskStr(newC)}</span></div>
            <div class="resitem"><span class="k">Anzahl Subnetze</span><span class="v">${fmt(count)}</span></div>
            <div class="resitem"><span class="k">Hosts pro Subnetz</span><span class="v">${fmt(info0.usable)}</span></div>
        </div><div class="explain">${why} Aus /${base} wird /${newC}: ${newC - base} Bit${newC - base === 1 ? '' : 's'} wandern vom Host- in den Netzteil. Jedes Subnetz umfasst ${fmt(size)} Adressen.</div>`;
        const segN = Math.min(count, 128);
        h += `<div class="split-vis" aria-hidden="true">${'<span></span>'.repeat(segN)}</div>`;
        if (count > segN) h += `<div class="cmp-info">Balken zeigt die ersten ${segN} von ${fmt(count)} Subnetzen.</div>`;
        const lim = showAll ? Math.min(count, 4096) : Math.min(count, SHOW);
        let rows = '';
        for (let i = 0; i < lim; i++) {
            const inf = subnetInfo((baseNet + i * size) >>> 0, newC);
            rows += `<tr data-ip="${intToIp(inf.network)}" data-c="${newC}"><td>${i + 1}</td><td>${intToIp(inf.network)}/${newC}</td><td>${intToIp(inf.firstHost)} – ${intToIp(inf.lastHost)}</td><td>${intToIp(inf.broadcast)}</td></tr>`;
        }
        h += `<div class="table-wrap tall"><table class="clickable"><thead><tr><th>#</th><th>Netz</th><th>Hostbereich</th><th>Broadcast</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        if (count > lim || showAll) h += `<button type="button" class="chip" id="spmore">${showAll ? 'Weniger anzeigen' : `Mehr anzeigen (${fmt(Math.min(count, 4096))})`}</button>`;
        out.innerHTML = h;
    }
    out.addEventListener('click', e => {
        if (e.target.id === 'spmore') {showAll = !showAll; render(); return;}
        const tr = e.target.closest('tr[data-ip]'); if (tr) calc.load(tr.dataset.ip, tr.dataset.c);
    });
    [ip, cidrEl, n].forEach(el => el.addEventListener('input', () => {showAll = false; render();}));
    return {render};
})();

// ---------- 07 CIDR-Tabelle ----------
const cidrTable = (function () {
    const cidrEl = $('s3cidr'), bar = $('s3bar'), wrap = $('s3wrap'), tbody = document.querySelector('#s3table tbody'), hosts = $('s3hosts');
    let h = '';
    for (let c = 0; c <= 32; c++) {
        const info = subnetInfo(0, c), m = magicInfo(c);
        h += `<tr data-c="${c}"><td>/${c}</td><td>${maskStr(c)}</td><td>${m ? `${m.block} <small>O${m.oct + 1}</small>` : '—'}</td><td>${fmt(info.total)}</td><td>${fmt(info.usable)}</td></tr>`;
    }
    tbody.innerHTML = h;
    const trs = [...tbody.children];
    function render() {
        const c = readPrefix(cidrEl);
        if (c === null) return;
        const pct = c / 32 * 100, info = subnetInfo(0, c);
        bar.innerHTML = `<div class="split-bar"><div class="n" style="width:${pct}%">${c > 3 ? c : ''}</div><div class="h" style="width:${100 - pct}%">${c < 29 ? 32 - c : ''}</div></div><div class="legend"><span class="l-net">Netzwerkbits: ${c}</span><span class="l-host">Hostbits: ${32 - c} → ${fmt(info.usable)} Hosts</span></div>`;
        trs.forEach(tr => tr.classList.toggle('current', +tr.dataset.c === c));
        const tr = trs[c];
        wrap.scrollTo({top: tr.offsetTop - wrap.clientHeight / 2 + tr.offsetHeight / 2, behavior: 'smooth'});
    }
    tbody.addEventListener('click', e => {const tr = e.target.closest('tr'); if (tr) setVal(cidrEl, tr.dataset.c);});
    cidrEl.addEventListener('input', render);
    hosts.addEventListener('input', () => {
        const want = parseInt(hosts.value, 10);
        if (!(want >= 1)) return;
        let hb = 2; while (Math.pow(2, hb) - 2 < want) hb++;
        if (hb <= 32) setVal(cidrEl, 32 - hb);
    });
    return {render};
})();

// ---------- 08 Trainer ----------
const quiz = (function () {
    const task = $('qtask'), opts = $('qopts'), fb = $('qfeedback'), nextBtn = $('qnext'), score = $('qscore');
    const KEY = 'subnetting-lab-quiz';
    let stats = {right: 0, total: 0, streak: 0, best: 0};
    try {stats = {...stats, ...JSON.parse(localStorage.getItem(KEY) || '{}')};} catch { /* ignorieren */ }
    const save = () => {try {localStorage.setItem(KEY, JSON.stringify(stats));} catch { /* ignorieren */ }};
    let cur = null, answered = false;
    const mode = segControl($('qmode'), () => newTask());
    const code = s => `<code>${s}</code>`;
    function options(correct, cands) {
        const set = [correct];
        for (const c of cands) {if (set.length >= 4) break; if (c != null && !set.includes(c)) set.push(c);}
        return shuffle(set);
    }
    const CLASSES = ['Gültiger Host', 'Netzwerkadresse', 'Broadcast-Adresse', 'Ungültige IP'];
    const gens = {
        classify() {
            const cidr = randInt(20, 29);
            if (Math.random() < 0.12) {
                const o = [192, 168, randInt(0, 255), randInt(256, 299)];
                return {q: `Was ist ${code(o.join('.') + '/' + cidr)}?`, options: CLASSES, fixed: true, correct: 'Ungültige IP', explain: `Ein IPv4-Oktett darf höchstens 255 sein — ${o[3]} ist zu groß. Die Adresse ist syntaktisch ungültig.`};
            }
            const info = subnetInfo(randomPrivateIp(), cidr), k = randInt(0, 2);
            let t, correct;
            if (k === 0) {t = info.network; correct = 'Netzwerkadresse';}
            else if (k === 1) {t = info.broadcast; correct = 'Broadcast-Adresse';}
            else {
                const edgeCase = Math.random() < 0.4;
                t = edgeCase ? (Math.random() < 0.5 ? info.firstHost : info.lastHost) : info.network + randInt(1, info.usable);
                correct = 'Gültiger Host';
            }
            const range = `${intToIp(info.network)} – ${intToIp(info.broadcast)}`;
            const explain = correct === 'Netzwerkadresse' ? `Bei /${cidr} umfasst das Netz ${range}. ${intToIp(t)} ist die erste Adresse — alle Hostbits sind 0.`
                : correct === 'Broadcast-Adresse' ? `Bei /${cidr} umfasst das Netz ${range}. ${intToIp(t)} ist die letzte Adresse — alle Hostbits sind 1.`
                    : `Bei /${cidr} umfasst das Netz ${range}. ${intToIp(t)} liegt zwischen Netz- und Broadcast-Adresse und ist damit ein gültiger Host (nutzbar: ${intToIp(info.firstHost)} – ${intToIp(info.lastHost)}).`;
            return {q: `Was ist ${code(intToIp(t) + '/' + cidr)}?`, options: CLASSES, fixed: true, correct, explain, load: [intToIp(t), cidr]};
        },
        netbc() {
            const cidr = randInt(18, 29), ipInt = randomPrivateIp(), info = subnetInfo(ipInt, cidr), bc = Math.random() < 0.5;
            const m = magicInfo(cidr), size = info.total;
            const correct = intToIp(bc ? info.broadcast : info.network);
            const cands = bc
                ? [intToIp(info.broadcast - size), intToIp(info.broadcast + size), intToIp(info.network), intToIp(info.broadcast - 1), intToIp((ipInt | 255) >>> 0)]
                : [intToIp(info.network + size), intToIp(info.network - size), intToIp(info.broadcast), intToIp(info.network + 1), intToIp((ipInt & 0xFFFFFF00) >>> 0)];
            const explain = `Blockgröße bei /${cidr}: 256 − ${m.maskOct} = ${m.block} im ${m.oct + 1}. Oktett. ${intToIp(ipInt)} liegt im Netz ${intToIp(info.network)} bis ${intToIp(info.broadcast)}.`;
            return {q: `Welche ${bc ? 'Broadcast-Adresse' : 'Netzwerkadresse'} hat ${code(intToIp(ipInt) + '/' + cidr)}?`, options: options(correct, shuffle(cands)), correct, explain, load: [intToIp(ipInt), cidr]};
        },
        hosts() {
            const cidr = randInt(16, 30), info = subnetInfo(0, cidr), hb = 32 - cidr;
            if (Math.random() < 0.5 || cidr >= 30) {
                const correct = fmt(info.usable);
                const cands = [fmt(info.total), fmt(info.total - 1), fmt(subnetInfo(0, cidr + 1).usable), fmt(subnetInfo(0, cidr - 1).usable), fmt(info.usable * 4 + 2)];
                return {q: `Wie viele nutzbare Hosts hat ein ${code('/' + cidr)}-Netz?`, options: options(correct, shuffle(cands)), correct, explain: `${hb} Hostbits → 2<sup>${hb}</sup> − 2 = ${fmt(info.total)} − 2 = ${fmt(info.usable)}. Die zwei abgezogenen Adressen sind Netz- und Broadcast-Adresse.`};
            }
            const want = randInt(Math.floor(info.usable / 2) + 1, info.usable);
            const correct = '/' + cidr;
            return {q: `Welches ist das längste Präfix (kleinste Netz), das ${code(fmt(want))} Hosts aufnimmt?`, options: options(correct, shuffle(['/' + (cidr + 1), '/' + (cidr - 1), '/' + (cidr + 2), '/' + (cidr - 2)])), correct, explain: `/${cidr} bietet 2<sup>${hb}</sup> − 2 = ${fmt(info.usable)} Hosts ≥ ${fmt(want)}. Ein /${cidr + 1} hätte nur ${fmt(subnetInfo(0, cidr + 1).usable)} — zu wenig.`};
        },
        mask() {
            const cidr = randInt(9, 30), correct = maskStr(cidr);
            if (Math.random() < 0.5) {
                const cands = [maskStr(cidr + 1), maskStr(cidr - 1), maskStr(Math.min(32, cidr + 8)), intToIp(~cidrToMaskInt(cidr) >>> 0), maskStr(cidr - 2)];
                return {q: `Welche Subnetzmaske entspricht ${code('/' + cidr)}?`, options: options(correct, shuffle(cands)), correct, explain: `/${cidr} = ${cidr} Einsen von links: ${[0, 1, 2, 3].map(o => toBin8((cidrToMaskInt(cidr) >>> (24 - 8 * o)) & 255)).join('.')} = ${correct}.`};
            }
            const c = '/' + cidr;
            return {q: `Welches Präfix hat die Maske ${code(correct)}?`, options: options(c, shuffle(['/' + (cidr + 1), '/' + (cidr - 1), '/' + (cidr + 2), '/' + (cidr - 2)])), correct: c, explain: `Zähle die Einsen: ${[0, 1, 2, 3].map(o => toBin8((cidrToMaskInt(cidr) >>> (24 - 8 * o)) & 255)).join('.')} → ${cidr} Einsen = ${c}.`};
        }
    };
    function renderScore() {
        const pct = stats.total ? Math.round(stats.right / stats.total * 100) : 0;
        score.innerHTML = `<span><b>${stats.right}</b>/${stats.total} richtig${stats.total ? ` (${pct} %)` : ''}</span><span>Serie <b>${stats.streak}</b></span><span>Beste <b>${stats.best}</b></span>`;
    }
    function newTask() {
        let m = mode();
        if (m === 'mix') m = ['classify', 'netbc', 'hosts', 'mask'][randInt(0, 3)];
        cur = gens[m]();
        answered = false;
        fb.innerHTML = '';
        task.innerHTML = cur.q;
        opts.innerHTML = cur.options.map((o, i) => `<button type="button" class="opt" data-opt="${o}"><kbd>${i + 1}</kbd>${o}</button>`).join('');
        nextBtn.textContent = 'Überspringen';
    }
    function answer(choice) {
        if (answered || !cur) return;
        answered = true;
        const ok = choice === cur.correct;
        stats.total++;
        if (ok) {stats.right++; stats.streak++; stats.best = Math.max(stats.best, stats.streak);} else stats.streak = 0;
        save(); renderScore();
        [...opts.children].forEach(b => {
            b.disabled = true;
            if (b.dataset.opt === cur.correct) b.classList.add('correct');
            else if (b.dataset.opt === choice) b.classList.add('wrong');
        });
        const loadBtn = cur.load ? ` <button type="button" class="chip" id="qload">Im Rechner ansehen</button>` : '';
        fb.innerHTML = `<div class="explain ${ok ? 'good' : 'bad'}"><span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'Richtig' : 'Falsch'}</span>${ok ? '' : ` Richtig wäre: <b>${cur.correct}</b>`}<br><br>${cur.explain}${loadBtn}</div>`;
        nextBtn.textContent = 'Nächste Aufgabe';
        nextBtn.focus({preventScroll: true});
    }
    opts.addEventListener('click', e => {const b = e.target.closest('.opt'); if (b) answer(b.dataset.opt);});
    fb.addEventListener('click', e => {if (e.target.id === 'qload' && cur.load) calc.load(...cur.load);});
    nextBtn.addEventListener('click', newTask);
    $('qreset').addEventListener('click', () => {stats = {right: 0, total: 0, streak: 0, best: 0}; save(); renderScore();});

    let visible = false;
    new IntersectionObserver(es => {visible = es[0].isIntersecting;}, {threshold: 0.3}).observe($('quiz'));
    document.addEventListener('keydown', e => {
        if (!visible || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest('input, textarea, select')) return;
        if (/^[1-4]$/.test(e.key) && !answered) {const b = opts.children[+e.key - 1]; if (b) {e.preventDefault(); answer(b.dataset.opt);}}
        else if (e.key === 'Enter' && answered && e.target === document.body) {e.preventDefault(); newTask();}
    });
    renderScore();
    return {newTask};
})();

// ---------- 09 Spickzettel: Bitwerte ----------
(function () {
    const pow = $('pow'), ex = $('powexplain');
    const vals = [128, 64, 32, 16, 8, 4, 2, 1];
    let sel = 2;
    function render() {
        let h = '<div class="pow-row pow-head"><span>Bit</span>' + vals.map((v, i) => `<button type="button" data-i="${i}" class="${i <= sel ? 'on' : ''}">${v}</button>`).join('') + '</div>';
        let acc = 0;
        h += '<div class="pow-row"><span>Maske</span>' + vals.map((v, i) => {acc += v; return `<button type="button" data-i="${i}" class="${i === sel ? 'sel' : i < sel ? 'on' : ''}">${acc}</button>`;}).join('') + '</div>';
        pow.innerHTML = h;
        const mv = 256 - vals[sel];
        ex.innerHTML = `${sel + 1} Bit gesetzt → Maskenwert <b>${mv}</b> (${toBin8(mv)}), Blockgröße <b>${vals[sel]}</b>. Z. B. /${16 + sel + 1} = 255.255.${mv}.0 oder /${24 + sel + 1} = 255.255.255.${mv}.`;
    }
    pow.addEventListener('click', e => {const b = e.target.closest('button'); if (b) {sel = +b.dataset.i; render();}});
    render();
})();

// ---------- Initial render ----------
viz.render(); calc.render(); cmp.render(); same.render(); check.render(); splitter.render(); cidrTable.render(); quiz.newTask();
