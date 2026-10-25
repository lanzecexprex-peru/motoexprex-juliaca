/* LANZEC MOTO EXPRESS - lógica del sitio (Supabase).
   Secciones: 1 Utilidades · 2 Sesión · 3 Servicios (compartido) · 4 Páginas · 5 Arranque */
(() => {
  'use strict';

  /* ============ 1. UTILIDADES ============ */
  const C = window.LANZEC_CONFIG || {};
  const page = document.body.dataset.page;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'S/ ' + Number(n).toFixed(2);
  const fdate = d => new Date(d).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  const pad = n => String(n).padStart(2, '0');

  const TYPE = { mototaxi: 'Mototaxi', delivery: 'Delivery' };
  const STATUS = { requested: 'Recibiendo ofertas', accepted: 'Aceptado', in_progress: 'En curso', completed: 'Completado', cancelled: 'Cancelado' };
  const PANEL = { admin: 'admin.html', transporter: 'transportista.html', client: 'cliente.html' };
  const PLANS = { // [id, nombre, días, precio S/]
    client: [['weekly', 'Semanal', 7, 2], ['monthly', 'Mensual', 30, 10]],
    transporter: [['weekly', 'Semanal', 7, 8], ['monthly', 'Mensual', 30, 25]]
  };

  let noticeTimer;
  const notice = (msg, bad = false) => {
    const n = $('#notice');
    if (!n) return alert(msg);
    n.textContent = msg;
    n.className = 'notice' + (bad ? ' bad' : '');
    n.hidden = false;
    clearTimeout(noticeTimer);
    if (!bad) noticeTimer = setTimeout(() => (n.hidden = true), 8000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const ERRORS = [
    [/Invalid login credentials/i, 'Correo o contraseña incorrectos.'],
    [/Email not confirmed/i, 'Debes confirmar tu correo antes de entrar.'],
    [/already registered|already been registered/i, 'Ese correo ya está registrado. Inicia sesión.'],
    [/Database error saving new user/i, 'No se pudo crear la cuenta. Verifica que el DNI no esté ya registrado.'],
    [/rate limit|too many/i, 'Demasiados intentos. Espera unos minutos.'],
    [/row-level security|permission denied/i, 'No tienes permiso para esta acción. Revisa que tu cuenta esté aprobada y tu suscripción activa.'],
    [/schema cache|Could not find the (table|function)/i, 'La base de datos de este proyecto no está instalada o no está visible. Abre diagnostico.html para ver qué falta.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Sin conexión con el servidor. Inténtalo de nuevo.']
  ];
  const friendly = e => { const m = e?.message || String(e); return (ERRORS.find(([re]) => re.test(m)) || [])[1] || m; };

  if (!window.supabase || !C.SUPABASE_KEY || /PEGA_AQUI/.test(C.SUPABASE_KEY)) {
    notice('Configuración incompleta: revisa js/config.js', true);
    return;
  }
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);

  const q = async p => { const r = await p; if (r.error) throw r.error; return r.data; };   // consulta -> datos o error
  const rpc = (name, args) => q(sb.rpc(name, args));

  // Envía un formulario con el botón bloqueado y errores amigables
  const onSubmit = (form, fn) => form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('button[type=submit]', form);
    if (b) b.disabled = true;
    try { await fn(new FormData(form)); } catch (err) { notice(friendly(err), true); }
    if (b) b.disabled = false;
  });

  /* ============ 2. SESIÓN ============ */
  const getSession = async () => (await sb.auth.getSession()).data.session;
  const getProfile = uid => q(sb.from('profiles').select('*').eq('id', uid).maybeSingle());

  // Exige sesión (y rol). Devuelve {user, profile} o redirige y devuelve null.
  async function guard(roles) {
    const s = await getSession();
    if (!s) { location.replace('login.html'); return null; }
    const p = await getProfile(s.user.id);
    if (!p) { await sb.auth.signOut(); location.replace('login.html'); return null; }
    if (roles && !roles.includes(p.role)) { location.replace(PANEL[p.role]); return null; }
    adaptNav(p);
    return { user: s.user, profile: p };
  }
  function adaptNav(p) {
    window.lanzecSetLogged?.(true);
    const a = $('[data-panel]'); if (a) a.href = PANEL[p.role];
    if (p.role === 'admin') $$('a[href="suscripcion.html"]').forEach(x => x.remove());
  }
  const blockedMsg = p => ({
    pending: 'Tu cuenta está pendiente de aprobación por administración.',
    suspended: 'Tu cuenta está suspendida. Contacta a administración.',
    rejected: 'Tu solicitud fue rechazada. Contacta a administración.'
  }[p.account_status] || null);

  // Cuenta regresiva de suscripción. Devuelve true si hay suscripción activa.
  let cdTimer;
  async function countdown(uid) {
    const el = $('#countdown');
    const rows = await q(sb.from('subscriptions').select('status,expires_at').eq('user_id', uid).in('status', ['active', 'paused'])
      .order('expires_at', { ascending: false }).limit(1));
    clearInterval(cdTimer);
    if (rows[0]?.status === 'paused') { if (el) el.textContent = 'Pausada por administración'; return false; }
    const exp = rows[0] ? new Date(rows[0].expires_at) : null;
    const tick = () => {
      const ms = exp ? exp - Date.now() : 0;
      if (ms <= 0) { if (el) el.textContent = exp ? 'Vencida' : 'Sin suscripción activa'; return false; }
      const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
      if (el) el.textContent = `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
      return true;
    };
    const active = tick();
    if (active) cdTimer = setInterval(() => tick() || clearInterval(cdTimer), 1000);
    return active;
  }

  const checkPhoto = f => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error('La foto debe ser JPG, PNG o WEBP.');
    if (f.size > 5 * 1024 * 1024) throw new Error('La foto supera 5 MB.');
  };
  async function uploadPhoto(file, uid) {
    checkPhoto(file);
    const path = `${uid}/${crypto.randomUUID()}.${{ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]}`;
    const { error } = await sb.storage.from('profile-photos').upload(path, file, { contentType: file.type });
    if (error) throw error;
    await rpc('set_my_photo', { p_path: path });
  }
  const photoUrl = path => sb.storage.from('profile-photos').getPublicUrl(path).data.publicUrl;

  /* ============ 3. SERVICIOS (cliente y transportista) ============ */
  const mapLink = t => {
    const m = /(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(t || '');
    return esc(t) + (m ? ` <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${m[1]},${m[2]}">Ver en mapa</a>` : '');
  };
  const waLink = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 9) d = '51' + d; return 'https://wa.me/' + d; };
  const contactHtml = c => !c ? '' :
    `<p><b>${esc(c.name)}</b> · <a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a> · <a target="_blank" rel="noopener" href="${waLink(c.phone)}">WhatsApp</a></p>` +
    (c.plate ? `<p class="muted">Moto: ${esc(c.motorcycle)} · ${esc(c.color)} · Placa ${esc(c.plate)}</p>` : '');
  const routeHtml = s =>
    `<p><b>${mapLink(s.origin)}</b>${s.origin_reference ? ` <span class="muted">(${esc(s.origin_reference)})</span>` : ''}<br>→ ${esc(s.destination)}</p>`;
  const headHtml = s => `<div class="row"><span class="pill">${TYPE[s.service_type]}</span><span class="pill">${STATUS[s.status]}</span></div>`;
  const btn = (act, id, label, cls = '', extra = '') => `<button class="btn ${cls} small" data-act="${act}" data-id="${id}" ${extra}>${label}</button>`;

  // Datos de contacto (solo tras aceptar). Se guardan en caché.
  const contactCache = {};
  async function getContacts(list) {
    await Promise.all(list.filter(s => ['accepted', 'in_progress', 'completed'].includes(s.status) && !contactCache[s.id])
      .map(async s => { try { const c = await rpc('service_contact', { p_id: s.id }); if (c) contactCache[s.id] = c; } catch (e) { /* se reintenta */ } }));
    return contactCache;
  }

  // Botones de acción -> funciones del servidor
  const status = (b, st) => rpc('update_service_status', { p_id: b.dataset.id, p_status: st });
  const ACTIONS = {
    'accept-offer': b => rpc('accept_offer', { p_offer: b.dataset.offer }),
    'cancel': b => status(b, 'cancelled'),
    'accept': b => rpc('accept_service', { p_id: b.dataset.id }),
    'offer': b => {
      const v = parseFloat(b.closest('.service-card').querySelector('input').value);
      if (!(v >= 0.5 && v <= 500)) throw new Error('Ingresa una oferta entre S/ 0.50 y S/ 500.');
      return rpc('make_offer', { p_service: b.dataset.id, p_price: v });
    },
    'withdraw-offer': b => rpc('withdraw_offer', { p_service: b.dataset.id }),
    'start': b => status(b, 'in_progress'),
    'finish': b => status(b, 'completed')
  };
  const CONFIRM = {
    cancel: '¿Cancelar este servicio?', finish: '¿Marcar el servicio como finalizado?', 'withdraw-offer': '¿Retirar tu oferta?',
    'accept-offer': '¿Aceptar esta oferta? Se rechazarán las demás.', accept: '¿Aceptar este servicio al precio propuesto?'
  };

  // Lista que se actualiza sola cada 8 s y solo redibuja si hay cambios. Devuelve la función "refresh".
  function liveList(box, load, render) {
    let last = '', busy = false, failed = false;
    const refresh = async (force = false) => {
      if (busy || (document.hidden && !force)) return;
      busy = true;
      try {
        const data = await load();
        const sig = JSON.stringify(data);
        const typing = box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
        if (force || (sig !== last && !typing)) { last = sig; box.innerHTML = render(data); }
        failed = false;
      } catch (e) { console.error(e); if (!failed) { failed = true; notice(friendly(e), true); } }
      busy = false;
    };
    box.addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (CONFIRM[act] && !confirm(CONFIRM[act])) return;
      b.disabled = true;
      try { await ACTIONS[act](b); notice('Listo.'); busy = false; await refresh(true); }
      catch (err) { notice(friendly(err), true); b.disabled = false; }
    });
    refresh(true);
    setInterval(() => refresh(), 8000);
    document.addEventListener('visibilitychange', () => !document.hidden && refresh(true));
    return refresh;
  }

  /* ============ 4. PÁGINAS ============ */
  const pages = {};

  pages.home = async () => {
    const s = await getSession(); if (!s) return;
    const p = await getProfile(s.user.id); if (!p) return;
    adaptNav(p);
    const box = $('#heroActions');
    if (box) box.innerHTML = `<a class="btn" href="${PANEL[p.role]}">Ir a mi panel</a>`;
  };

  pages.login = async () => {
    const s = await getSession();
    if (s) { const p = await getProfile(s.user.id); if (p) return location.replace(PANEL[p.role]); }
    onSubmit($('#loginForm'), async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim().toLowerCase(), password: $('#password').value });
      if (error) throw error;
      const p = await getProfile(data.user.id);
      if (!p) throw new Error('No se encontró tu perfil. Contacta a administración.');
      location.href = PANEL[p.role];
    });
  };

  const registerPage = role => () => onSubmit($('#registerForm'), async d => {
    const v = n => String(d.get(n) || '').trim();
    const pw = String(d.get('password') || '');
    const age = parseInt(v('age'), 10);
    if (pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (pw !== d.get('confirm_password')) throw new Error('Las contraseñas no coinciden.');
    if (!/^\d{8}$/.test(v('dni'))) throw new Error('El DNI debe tener exactamente 8 dígitos.');
    if (!(age >= 18 && age <= 100)) throw new Error('Debes ser mayor de 18 años.');
    if (!/^[0-9+\s-]{6,20}$/.test(v('phone'))) throw new Error('Ingresa un celular válido.');
    const meta = { role, full_name: v('full_name'), age, dni: v('dni'), phone: v('phone') };
    let file = null;
    if (role === 'transporter') {
      Object.assign(meta, { motorcycle: v('motorcycle'), plate: v('plate').toUpperCase(), motorcycle_color: v('motorcycle_color'), service_types: d.getAll('service_types') });
      if (!meta.service_types.length) throw new Error('Selecciona Mototaxi, Delivery o ambos.');
      file = $('[name=profile_photo]').files[0] || null;
      if (file) checkPhoto(file);
    }
    const { data, error } = await sb.auth.signUp({ email: v('email').toLowerCase(), password: pw, options: { data: meta } });
    if (error) throw error;
    if (data.user?.identities && !data.user.identities.length) throw new Error('Ese correo ya está registrado. Inicia sesión.');
    if (data.session) {
      if (file) await uploadPhoto(file, data.user.id).catch(console.error);
      notice('Cuenta creada. Ahora elige tu suscripción.');
      setTimeout(() => (location.href = 'suscripcion.html'), 900);
    } else {
      notice('Cuenta creada. Confirma tu correo y luego inicia sesión.');
      setTimeout(() => (location.href = 'login.html'), 3500);
    }
  });
  pages['register-client'] = registerPage('client');
  pages['register-transporter'] = registerPage('transporter');

  pages.subscription = async () => {
    const form = $('#subscriptionForm');
    const s = await getSession();
    if (!s) { notice('Inicia sesión para solicitar tu suscripción.', true); form.style.display = 'none'; return; }
    const p = await getProfile(s.user.id);
    if (!p) return notice('No se encontró tu perfil.', true);
    if (p.role === 'admin') return location.replace('admin.html');
    adaptNav(p);
    const plans = PLANS[p.role];
    $('#plans').innerHTML = plans.map(([id, name, days, price], i) =>
      `<label class="plan"><input type="radio" name="plan" value="${id}" ${i ? '' : 'checked'}><span><b>${name}</b><small>${days} días</small></span><strong>S/ ${price}</strong></label>`).join('');
    $('#yapePhone').textContent = C.YAPE_PHONE;
    $('#yapeHolder').textContent = C.YAPE_HOLDER;

    const hist = document.createElement('section');
    hist.className = 'card';
    $('main').append(hist);
    const loadHist = async () => {
      const rows = await q(sb.from('subscriptions').select('*').eq('user_id', p.id).order('created_at', { ascending: false }).limit(10));
      const L = { pending: 'En revisión', active: 'Activa', paused: 'Pausada', expired: 'Vencida', rejected: 'Rechazada' };
      hist.innerHTML = '<h2>Mis solicitudes</h2>' + (rows.map(x =>
        `<div class="service-card"><div class="row"><b>${x.plan === 'weekly' ? 'Semanal' : 'Mensual'} · ${money(x.amount)}</b><span class="pill">${L[x.status]}</span></div>` +
        `<small class="muted">Solicitada ${fdate(x.created_at)}${x.status === 'active' ? ' · vence ' + fdate(x.expires_at) : ''}</small></div>`).join('') || '<div class="empty">Aún no tienes solicitudes.</div>');
    };
    loadHist().catch(e => notice(friendly(e), true));

    onSubmit(form, async d => {
      const [, name, , price] = plans.find(x => x[0] === d.get('plan'));
      const id = await rpc('request_subscription', { p_plan: d.get('plan') });
      const isT = p.role === 'transporter';
      const msg = `Hola, quiero activar mi suscripción ${name} (S/ ${price}) en LANZEC MOTO EXPRESS.\nNombre: ${p.full_name}\nDNI: ${p.dni}\nCelular: ${p.phone}\n` +
        `Correo: ${p.email}\nTipo de cuenta: ${isT ? 'Transportista' : 'Cliente'}\nSolicitud: ${String(id).slice(0, 8)}\nAdjunto mi captura de pago de Yape${isT ? ' y la foto del frente de mi DNI.' : '.'}`;
      const url = `https://wa.me/${C.WHATSAPP}?text=${encodeURIComponent(msg)}`;
      let box = $('#waBox');
      if (!box) { box = document.createElement('div'); box.id = 'waBox'; box.className = 'card'; form.parentNode.append(box); }
      box.innerHTML = `<p>✅ Solicitud registrada. Abre WhatsApp y adjunta manualmente tu captura de pago${isT ? ' y la foto de tu DNI' : ''}.</p><a class="btn" target="_blank" rel="noopener" href="${esc(url)}">Abrir WhatsApp</a>`;
      window.open(url, '_blank', 'noopener');
      await loadHist();
    });
  };

  pages.client = async () => {
    const g = await guard(['client']); if (!g) return;
    $('#welcome').textContent = 'Hola, ' + g.profile.full_name.split(' ')[0];
    const hasSub = await countdown(g.user.id);
    const form = $('#requestForm');
    const blocked = blockedMsg(g.profile);
    if (blocked) { notice(blocked, true); form.style.display = 'none'; return; }
    if (!hasSub) notice('No tienes suscripción activa. Para solicitar servicios, activa un plan en "Suscripciones".', true);

    $('#locate').addEventListener('click', e => {
      if (!navigator.geolocation) return notice('Tu navegador no permite obtener la ubicación.', true);
      const b = e.currentTarget; b.disabled = true;
      navigator.geolocation.getCurrentPosition(pos => {
        $('#origin').value = `Ubicación GPS: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        b.disabled = false;
        notice('Ubicación agregada. Puedes añadir una referencia.');
      }, () => { b.disabled = false; notice('No se pudo obtener tu ubicación. Escribe la dirección.', true); }, { enableHighAccuracy: true, timeout: 10000 });
    });

    const offersHtml = list => !list.length
      ? '<div class="details"><small class="muted">Aún no hay ofertas. Los transportistas pueden aceptar tu precio u ofertar otro. Se actualiza solo.</small></div>'
      : `<div class="details"><b>Ofertas recibidas (${list.length})</b>` + list.map((o, i) =>
        `<div class="row" style="margin-top:10px;flex-wrap:wrap"><div style="display:flex;gap:10px;align-items:center">` +
        (o.photo_path ? `<img alt="" src="${esc(photoUrl(o.photo_path))}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--cyan)">` : '') +
        `<div><b>${esc(o.transporter_name)}</b>${i === 0 && list.length > 1 ? ' <span class="badge">Mejor precio</span>' : ''}<br><small class="muted">${esc(o.motorcycle)} · ${esc(o.color)}</small></div></div>` +
        `<div style="display:flex;gap:10px;align-items:center"><strong style="font-size:1.3rem;color:var(--cyan)">${money(o.price)}</strong>${btn('accept-offer', o.service_id, 'Aceptar', '', `data-offer="${o.offer_id}"`)}</div></div>`).join('') + '</div>';

    const refresh = liveList($('#myServices'), async () => {
      const services = await q(sb.from('services').select('*').eq('client_id', g.user.id).order('created_at', { ascending: false }).limit(50));
      return { services, offers: await rpc('client_offers'), contacts: await getContacts(services) };
    }, ({ services, offers, contacts }) => !services.length ? '<div class="empty">Aún no has solicitado servicios.</div>' : services.map(s =>
      `<div class="service-card">${headHtml(s)}${routeHtml(s)}` +
      `<p>${s.status === 'requested' ? 'Tu precio propuesto' : 'Precio acordado'}: <b>${money(s.final_price || s.proposed_price)}</b> · Pago: ${esc(s.payment_method)}</p>` +
      (s.note ? `<p class="muted">${esc(s.note)}</p>` : '') +
      (s.status === 'requested' ? offersHtml(offers.filter(o => o.service_id === s.id)) : '') +
      (contacts[s.id] ? `<div class="details">${contactHtml(contacts[s.id])}</div>` : '') +
      `<small class="muted">${fdate(s.created_at)}</small>` +
      (['requested', 'accepted'].includes(s.status) ? `<div class="actions">${btn('cancel', s.id, 'Cancelar', 'danger')}</div>` : '') + '</div>').join(''));

    onSubmit(form, async d => {
      const price = parseFloat(d.get('proposed_price'));
      if (!(price >= 0.5 && price <= 500)) throw new Error('El precio debe estar entre S/ 0.50 y S/ 500.');
      const { error } = await sb.from('services').insert({
        client_id: g.user.id, service_type: d.get('service_type'), origin: String(d.get('origin')).trim(),
        origin_reference: String(d.get('origin_reference') || '').trim() || null, destination: String(d.get('destination')).trim(),
        payment_method: d.get('payment_method'), note: String(d.get('note') || '').trim() || null, proposed_price: price
      });
      if (error) throw /row-level security/i.test(error.message)
        ? new Error('No se pudo enviar: necesitas una suscripción activa y máximo 5 servicios abiertos a la vez.') : error;
      notice('Solicitud enviada. Espera las ofertas de los transportistas.');
      form.reset();
      await refresh(true);
    });
  };

  pages.transporter = async () => {
    const g = await guard(['transporter']); if (!g) return;
    const uid = g.user.id;
    $('#welcome').textContent = 'Hola, ' + g.profile.full_name.split(' ')[0];
    const hasSub = await countdown(uid);
    const box = $('#requests');

    const t = await q(sb.from('transporter_profiles').select('*').eq('user_id', uid).maybeSingle());
    if (t?.photo_path) {
      $('#welcome').insertAdjacentHTML('beforebegin', `<img class="avatar" alt="Tu foto" src="${esc(photoUrl(t.photo_path))}">`);
    } else if (t) {
      const card = document.createElement('section');
      card.className = 'card';
      card.innerHTML = '<h2>Foto de perfil</h2><p class="muted">Sube tu foto para que los clientes te reconozcan (JPG/PNG/WEBP, máx. 5 MB).</p>' +
        '<form><input type="file" accept="image/jpeg,image/png,image/webp" required><button class="btn" type="submit">Subir foto</button></form>';
      $('main').insertBefore(card, $('main section.card'));
      onSubmit($('form', card), async () => { await uploadPhoto($('input', card).files[0], uid); card.remove(); notice('Foto subida correctamente.'); });
    }

    const blocked = blockedMsg(g.profile);
    if (blocked) { notice(blocked, true); box.innerHTML = `<div class="empty">${esc(blocked)}</div>`; return; }
    if (!hasSub) notice('Tu suscripción no está activa. Renueva para recibir nuevas solicitudes.', true);

    const availCard = (s, mo) => `<div class="service-card"><div class="row"><span class="pill">${TYPE[s.service_type]}</span><b>${money(s.proposed_price)}</b></div>${routeHtml(s)}` +
      `<p class="muted">Cliente: ${esc(s.client_name || '—')} · Pago: ${esc(s.payment_method)}</p>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}` +
      (mo?.status === 'pending' ? `<p>Tu oferta: <b>${money(mo.price)}</b> · esperando que el cliente elija.</p>` : '') +
      `<div class="actions">${btn('accept', s.id, 'Aceptar ' + money(s.proposed_price))}</div>` +
      `<div class="actions"><input type="number" min="0.5" max="500" step="0.5" placeholder="Tu oferta S/" style="max-width:170px" aria-label="Tu oferta">` +
      `${btn('offer', s.id, mo?.status === 'pending' ? 'Actualizar oferta' : 'Enviar oferta', 'secondary')}` +
      `${mo?.status === 'pending' ? btn('withdraw-offer', s.id, 'Retirar oferta', 'ghost') : ''}</div><small class="muted">${fdate(s.created_at)}</small></div>`;
    const mineCard = (s, c) => `<div class="service-card">${headHtml(s)}${routeHtml(s)}` +
      `<p>Precio: <b>${money(s.final_price || s.proposed_price)}</b> · Pago: ${esc(s.payment_method)}</p>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}` +
      (c ? `<div class="details"><small class="muted">Cliente</small>${contactHtml(c)}</div>` : '') +
      (s.status === 'accepted' ? `<div class="actions">${btn('start', s.id, 'Iniciar servicio')}${btn('cancel', s.id, 'Cancelar', 'danger')}</div>` : '') +
      (s.status === 'in_progress' ? `<div class="actions">${btn('finish', s.id, 'Finalizar servicio')}</div>` : '') + '</div>';

    liveList(box, async () => {
      const services = await q(sb.from('services').select('*').order('created_at', { ascending: false }).limit(100));
      const offers = await q(sb.from('offers').select('*').eq('transporter_id', uid));
      return { services, offers, contacts: await getContacts(services.filter(s => s.transporter_id === uid)) };
    }, ({ services, offers, contacts }) => {
      const avail = services.filter(s => s.status === 'requested');
      const mine = services.filter(s => s.transporter_id === uid);
      const byService = Object.fromEntries(offers.map(o => [o.service_id, o]));
      return `<h3>Disponibles (${avail.length})</h3>` +
        (avail.map(s => availCard(s, byService[s.id])).join('') || `<div class="empty">${hasSub ? 'No hay solicitudes compatibles por ahora. Se actualiza solo.' : 'Activa tu suscripción para ver solicitudes. <a href="suscripcion.html">Suscripciones</a>'}</div>`) +
        '<h3 class="section-title">Mis servicios</h3>' +
        (mine.map(s => mineCard(s, contacts[s.id])).join('') || '<div class="empty">Aún no has tomado servicios.</div>');
    });
  };

  pages.complaints = async () => {
    const g = await guard(null); if (!g) return;
    const form = $('#complaintForm');
    const services = await q(sb.from('services').select('id,service_type,origin,destination,created_at')
      .or(`client_id.eq.${g.user.id},transporter_id.eq.${g.user.id}`).order('created_at', { ascending: false }).limit(30));
    const input = form.elements.service_id;
    const select = document.createElement('select');
    select.name = 'service_id';
    select.innerHTML = '<option value="">Ninguno</option>' + services.map(s =>
      `<option value="${s.id}">${TYPE[s.service_type]} · ${esc(s.origin.slice(0, 30))} → ${esc(s.destination.slice(0, 30))} · ${fdate(s.created_at)}</option>`).join('');
    const label = input.closest('label');
    input.replaceWith(select);
    label.firstChild.textContent = 'Servicio relacionado (opcional)';

    const list = document.createElement('section');
    list.className = 'card';
    list.style.cssText = 'max-width:760px;margin-inline:auto';
    $('main').append(list);
    const loadList = async () => {
      const rows = await q(sb.from('complaints').select('*').eq('user_id', g.user.id).order('created_at', { ascending: false }).limit(20));
      const L = { open: 'Abierto', in_review: 'En revisión', resolved: 'Resuelto' };
      list.innerHTML = '<h2>Mis reclamos</h2>' + (rows.map(c =>
        `<div class="service-card"><div class="row"><b>${esc(c.reason)}</b><span class="pill">${L[c.status]}</span></div><p>${esc(c.description)}</p><small class="muted">${fdate(c.created_at)}</small></div>`).join('') || '<div class="empty">No has enviado reclamos.</div>');
    };
    loadList().catch(e => notice(friendly(e), true));
    onSubmit(form, async d => {
      const { error } = await sb.from('complaints').insert({
        user_id: g.user.id, reason: d.get('reason'), service_id: d.get('service_id') || null, description: String(d.get('description')).trim()
      });
      if (error) throw error;
      notice('Reclamo enviado. Administración lo revisará.');
      form.reset();
      await loadList();
    });
  };

  pages.admin = async () => {
    const g = await guard(['admin']); if (!g) return;
    $('#welcome').textContent = 'Panel de administración';

    const ACCT = { pending: ['Pendiente', 'warn'], active: ['Activa', 'good'], suspended: ['Pausada', 'bad'], rejected: ['Rechazada', 'bad'] };
    const SUBL = { pending: 'En revisión', active: 'Activa', paused: 'Pausada', expired: 'Vencida', rejected: 'Rechazada' };
    const list = (arr, fn) => arr.map(fn).join('') || '<div class="empty">Sin registros.</div>';
    const a = (act, id, v, label, cls = '') => `<button class="btn ${cls} small" data-a="${act}" data-id="${id}" data-v="${v}">${label}</button>`;
    const row = (left, state, buttons = '') =>
      `<div class="admin-row"><div class="row"><div>${left}</div>${state ? `<span class="pill">${state}</span>` : ''}</div>${buttons ? `<div class="actions">${buttons}</div>` : ''}</div>`;

    const load = async () => {
      const get = (t, n) => q(sb.from(t).select('*').order('created_at', { ascending: false }).limit(n));
      const [profiles, subs, services, complaints, audit, offers] = await Promise.all([
        get('profiles', 1000), get('subscriptions', 500), get('services', 300), get('complaints', 200), get('audit_log', 100), get('offers', 2000)]);
      const tps = await q(sb.from('transporter_profiles').select('*'));
      const user = Object.fromEntries(profiles.map(p => [p.id, p]));
      const tp = Object.fromEntries(tps.map(t => [t.user_id, t]));
      const name = id => esc(user[id]?.full_name || '—');
      const offerCount = {}; offers.filter(o => o.status === 'pending').forEach(o => (offerCount[o.service_id] = (offerCount[o.service_id] || 0) + 1));
      const clients = profiles.filter(p => p.role === 'client'), trs = profiles.filter(p => p.role === 'transporter');

      // estado de suscripción de un usuario
      const subOf = uid => {
        const mine = subs.filter(x => x.user_id === uid);
        const act = mine.find(x => x.status === 'active' && new Date(x.expires_at) > Date.now());
        if (act) return { k: 'active', row: act, label: 'Activa · vence ' + fdate(act.expires_at), cls: 'good' };
        const pau = mine.find(x => x.status === 'paused');
        if (pau) return { k: 'paused', row: pau, label: 'Pausada', cls: 'warn' };
        const pen = mine.find(x => x.status === 'pending');
        if (pen) return { k: 'pending', row: pen, label: 'Pago en revisión', cls: 'warn' };
        return { k: 'none', label: mine.length ? 'Vencida' : 'Sin suscripción', cls: 'bad' };
      };

      $('#stats').innerHTML = [
        [clients.length, 'Clientes'], [trs.length, 'Transportistas'],
        [trs.filter(p => p.account_status === 'pending').length, 'Transportistas por aprobar'],
        [subs.filter(x => x.status === 'pending').length, 'Pagos pendientes'],
        [profiles.filter(p => p.role !== 'admin' && subOf(p.id).k === 'active').length, 'Suscripciones activas'],
        [complaints.filter(c => c.status !== 'resolved').length, 'Reclamos abiertos']
      ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
      const setTab = (id, label, n) => { const t = $(`[data-tab=${id}]`); if (t) t.textContent = `${label} (${n})`; };
      setTab('clients', 'Clientes', clients.length); setTab('transporters', 'Transportistas', trs.length);
      setTab('payments', 'Pagos', subs.filter(x => x.status === 'pending').length + ' pend.'); setTab('services', 'Servicios', services.length);
      setTab('complaints', 'Reclamos', complaints.filter(c => c.status !== 'resolved').length + ' abiertos');

      // ficha de cliente / transportista (desplegable)
      const openIds = new Set($$('details.user[open]').map(d => d.dataset.id));
      const userCard = p => {
        const t = tp[p.id], ss = subOf(p.id), [al, ac] = ACCT[p.account_status];
        const mine = services.filter(s => s.client_id === p.id || s.transporter_id === p.id);
        const done = mine.filter(s => s.status === 'completed').length;
        const acct = p.account_status === 'active' ? a('status', p.id, 'suspended', '⏸ Pausar cuenta', 'danger')
          : a('status', p.id, 'active', p.account_status === 'pending' ? '✔ Aprobar cuenta' : '▶ Activar cuenta') +
            (p.account_status === 'pending' ? a('status', p.id, 'rejected', 'Rechazar', 'danger') : '');
        const subBtns = (ss.k === 'active' ? a('pause', p.id, 1, '⏸ Pausar suscripción', 'ghost') : '') +
          (ss.k === 'paused' ? a('pause', p.id, 0, '▶ Reanudar suscripción') : '') +
          (ss.k === 'pending' ? a('sub', ss.row.id, 1, '✔ Aprobar pago') + a('sub', ss.row.id, 0, 'Rechazar pago', 'danger') : '') +
          (ss.k !== 'paused' ? a('grant', p.id, 'weekly', 'Activar 7 días', 'secondary') + a('grant', p.id, 'monthly', 'Activar 30 días', 'secondary') : '');
        const q = [p.full_name, p.dni, p.phone, p.email, t?.plate].join(' ').toLowerCase();
        return `<details class="user" data-id="${p.id}" data-q="${esc(q)}" ${openIds.has(p.id) ? 'open' : ''}>
          <summary><span class="uname">${esc(p.full_name)}</span><span class="pill ${ac}">Cuenta ${al}</span><span class="pill ${ss.cls}">Suscripción: ${ss.label}</span></summary>
          <div class="udetail">
            ${t?.photo_path ? `<img class="avatar" alt="" src="${esc(photoUrl(t.photo_path))}">` : ''}
            <div class="kv">
              <p><span class="muted">DNI:</span> ${esc(p.dni)}</p><p><span class="muted">Edad:</span> ${esc(p.age)} años</p>
              <p><span class="muted">Celular:</span> <a href="${waLink(p.phone)}" target="_blank" rel="noopener">${esc(p.phone)}</a></p>
              <p><span class="muted">Correo:</span> ${esc(p.email)}</p>
              <p><span class="muted">Registro:</span> ${fdate(p.created_at)}</p>
              <p><span class="muted">Servicios:</span> ${mine.length} (${done} completados)</p>
              ${t ? `<p><span class="muted">Moto:</span> ${esc(t.motorcycle)} · ${esc(t.motorcycle_color)}</p><p><span class="muted">Placa:</span> ${esc(t.plate)}</p>
                     <p><span class="muted">Ofrece:</span> ${esc(t.service_types.map(x => TYPE[x]).join(' y '))}</p>` : ''}
            </div>
            <h4>Suscripción</h4>
            <p>${ss.label}${ss.k === 'none' ? '' : ''}</p>
            ${(() => { const h = subs.filter(x => x.user_id === p.id).slice(0, 4); return h.length ? '<div class="muted">' + h.map(x =>
              `${x.plan === 'weekly' ? '7 días' : '30 días'} · ${money(x.amount)} · ${SUBL[x.status]} · ${fdate(x.created_at)}`).join('<br>') + '</div>' : ''; })()}
            <div class="actions">${subBtns}</div>
            <h4>Últimos servicios</h4>
            ${mine.slice(0, 4).map(s => `<small class="muted">${TYPE[s.service_type]} · ${esc(s.origin.slice(0, 28))} → ${esc(s.destination.slice(0, 28))} · ${money(s.final_price || s.proposed_price)} · ${STATUS[s.status]}</small>`).join('<br>') || '<small class="muted">Sin servicios.</small>'}
            <h4>Cuenta</h4>
            <div class="actions">${acct}</div>
          </div></details>`;
      };
      $('#adminClients').innerHTML = list(clients, userCard);
      $('#adminTransporters').innerHTML = list(trs, userCard);
      $$('.search').forEach(i => i.dispatchEvent(new Event('input', { bubbles: true })));

      $('#adminSubscriptions').innerHTML = list([...subs].sort((x, y) => (y.status === 'pending') - (x.status === 'pending')), s =>
        row(`<b>${name(s.user_id)}</b> <small>(${user[s.user_id]?.role === 'client' ? 'cliente' : 'transportista'}) · ${s.plan === 'weekly' ? 'Semanal' : 'Mensual'} · ${money(s.amount)}</small>` +
          `<small>Solicitada ${fdate(s.created_at)}${s.status === 'active' ? ' · vence ' + fdate(s.expires_at) : ''}</small>`, SUBL[s.status],
          s.status === 'pending' ? a('sub', s.id, 1, '✔ Aprobar pago') + a('sub', s.id, 0, 'Rechazar', 'danger') : ''));

      $('#adminServices').innerHTML = list(services, s =>
        row(`<b>${TYPE[s.service_type]}</b> · ${esc(s.origin)} → ${esc(s.destination)}<small>Cliente: ${name(s.client_id)} · Transportista: ${name(s.transporter_id)} · ${money(s.final_price || s.proposed_price)} · ${esc(s.payment_method)}` +
          `${s.status === 'requested' ? ' · Ofertas: ' + (offerCount[s.id] || 0) : ''} · ${fdate(s.created_at)}</small><small>ID: ${s.id}</small>`, STATUS[s.status]));

      const CL = { open: 'Abierto', in_review: 'En revisión', resolved: 'Resuelto' };
      $('#adminComplaints').innerHTML = list(complaints, c =>
        row(`<b>${esc(c.reason)}</b> · ${name(c.user_id)}<small>${fdate(c.created_at)}${c.service_id ? ' · Servicio ' + c.service_id : ''}</small><p>${esc(c.description)}</p>`, CL[c.status],
          (c.status === 'open' ? a('comp', c.id, 'in_review', 'En revisión', 'ghost') : '') + (c.status !== 'resolved' ? a('comp', c.id, 'resolved', 'Marcar resuelto') : '')));

      const AL = { account_status: 'Cambio de estado de cuenta', subscription_approved: 'Pago aprobado', subscription_rejected: 'Pago rechazado',
        subscription_paused: 'Suscripción pausada', subscription_resumed: 'Suscripción reanudada', subscription_granted: 'Suscripción activada manualmente', complaint_status: 'Estado de reclamo' };
      $('#adminAudit').innerHTML = list(audit, x => {
        const d = x.detail || {};
        const target = x.target_type === 'user' ? name(x.target_id) : d.user_id ? name(d.user_id) : String(x.target_id || '').slice(0, 8);
        const info = d.to ? (d.from ? `${esc(d.from)} → ${esc(d.to)}` : esc(d.to)) : d.plan ? `${esc(d.plan)} · ${money(d.amount)}` : '';
        return row(`<b>${AL[x.action] || esc(x.action)}</b><small>${fdate(x.created_at)} · Admin: ${name(x.admin_id)} · Objetivo: ${target}${info ? ' · ' + info : ''}</small>`, '');
      });
    };

    // pestañas
    $('#tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab'); if (!t) return;
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      $$('main > section[id^=tab-]').forEach(sec => (sec.hidden = sec.id !== 'tab-' + t.dataset.tab));
    });
    // buscador
    $('main').addEventListener('input', e => {
      const i = e.target.closest('.search'); if (!i) return;
      const text = i.value.trim().toLowerCase();
      $$('details.user', $('#' + i.dataset.search)).forEach(d => (d.hidden = !!text && !d.dataset.q.includes(text)));
    });
    // acciones
    const CONFIRM_A = {
      status: v => v === 'suspended' ? '¿Pausar esta cuenta? No podrá usar la plataforma.' : v === 'rejected' ? '¿Rechazar esta cuenta?' : null,
      pause: v => v === '1' ? '¿Pausar la suscripción? Se conservan los días restantes.' : null,
      grant: () => '¿Activar el acceso manualmente (sin pago registrado en la web)?'
    };
    $('main').addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const { a: act, id, v } = b.dataset;
      const msg = CONFIRM_A[act]?.(v);
      if (msg && !confirm(msg)) return;
      b.disabled = true;
      try {
        if (act === 'status') await rpc('admin_set_account_status', { p_user: id, p_status: v });
        if (act === 'sub') await rpc('admin_review_subscription', { p_id: id, p_approve: v === '1' });
        if (act === 'pause') await rpc('admin_set_subscription_paused', { p_user: id, p_pause: v === '1' });
        if (act === 'grant') await rpc('admin_grant_subscription', { p_user: id, p_plan: v });
        if (act === 'comp') await rpc('admin_set_complaint_status', { p_id: id, p_status: v });
        notice('Cambio guardado.');
        await load();
      } catch (err) { notice(friendly(err), true); b.disabled = false; }
    });
    await load();
  };

  /* ============ 5. ARRANQUE ============ */
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-logout]')) {
      e.preventDefault();
      await sb.auth.signOut();
      location.href = 'index.html';
    }
    const c = e.target.closest('[data-copy]');            // botón "Copiar" (número de Yape)
    if (c) {
      const text = $(c.dataset.copy).textContent.trim();
      try { await navigator.clipboard.writeText(text); }
      catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
      const old = c.textContent; c.textContent = '✅ Copiado';
      setTimeout(() => (c.textContent = old), 2000);
    }
  });

  (async () => {
    window.lanzecSetLogged?.(!!(await getSession()));
    await pages[page]?.();
  })().catch(e => { console.error(e); notice(friendly(e), true); });
})();
