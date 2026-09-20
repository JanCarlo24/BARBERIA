const BARBERS = [
  { id: 'b1', name: 'Rodrigo Salas', specialty: 'Cortes clásicos y fade', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=80' },
  { id: 'b2', name: 'Ana Ibarra', specialty: 'Barba y diseño de líneas', photo: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=160&q=80' },
  { id: 'b3', name: 'Mario Gómez', specialty: 'Cortes modernos y color', photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=160&q=80' }
];
const SERVICES = [
  { id: 's1', name: 'Corte de cabello', duration: 30, price: 150 },
  { id: 's2', name: 'Corte + barba', duration: 45, price: 220 },
  { id: 's3', name: 'Arreglo de barba', duration: 20, price: 120 },
  { id: 's4', name: 'Corte para niño', duration: 30, price: 130 }
];
const OPEN_HOUR = 10;
const CLOSE_HOUR = 19;
const SLOT_STEP_MIN = 30;
const DOW_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

let state = {
  view: 'loading', currentUser: null, accounts: {}, appointments: [],
  waitlist: [], reschedulingId: null, panelBarberFilter: 'todos', panelStatusFilter: 'todos',
  booking: { barberId: null, serviceId: null, date: null, time: null },
  loginErrors: {}, registerErrors: {}, justCreatedId: null
};

const storage = {
  async get(key) {
    try {
      if (window.storage) {
        const value = await window.storage.get(key, true);
        return value ? JSON.parse(value.value) : null;
      }
      const value = localStorage.getItem(`filo-${key}`);
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      if (window.storage) await window.storage.set(key, JSON.stringify(value), true);
      else localStorage.setItem(`filo-${key}`, JSON.stringify(value));
    } catch (error) { console.error(`No se pudo guardar ${key}`, error); }
  }
};

async function loadData() {
  state.accounts = await storage.get('accounts') || {};
  state.appointments = await storage.get('appointments') || [];
  state.waitlist = await storage.get('waitlist') || [];
}
function saveAccounts() { return storage.set('accounts', state.accounts); }
function saveAppointments() { return storage.set('appointments', state.appointments); }
function saveWaitlist() { return storage.set('waitlist', state.waitlist); }
function addDays(base, days) { const date = new Date(base); date.setDate(date.getDate() + days); return date; }
function toKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function nextAvailableDates(count) {
  const dates = []; let date = new Date(); date.setHours(0, 0, 0, 0);
  while (dates.length < count) { if (date.getDay() !== 0) dates.push(new Date(date)); date = addDays(date, 1); }
  return dates;
}
function toMinutes(time) { const [hours, minutes] = time.split(':').map(Number); return hours * 60 + minutes; }
function generateTimeSlots() {
  const slots = [];
  for (let minutes = OPEN_HOUR * 60; minutes < CLOSE_HOUR * 60; minutes += SLOT_STEP_MIN) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return slots;
}
function isSlotAvailable(barberId, dateKey, time, duration) {
  const start = toMinutes(time); const end = start + duration;
  if (end > CLOSE_HOUR * 60) return false;
  const today = toKey(new Date());
  if (dateKey === today) {
    const now = new Date();
    if (start <= now.getHours() * 60 + now.getMinutes()) return false;
  }
  return !state.appointments.some(appointment => {
    if (appointment.barberId !== barberId || appointment.date !== dateKey || appointment.status === 'cancelada') return false;
    const appointmentStart = toMinutes(appointment.time);
    const appointmentEnd = appointmentStart + (appointment.duration || 30);
    return start < appointmentEnd && end > appointmentStart;
  });
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
function el(html) { const template = document.createElement('template'); template.innerHTML = html.trim(); return template.content.firstChild; }
function getCurrentService() { return SERVICES.find(service => service.id === state.booking.serviceId); }
function beginReschedule(appointment) {
  state.reschedulingId = appointment.id;
  state.booking = { barberId: appointment.barberId, serviceId: appointment.serviceId, date: appointment.date, time: appointment.time };
  state.view = 'book-datetime';
  renderApp();
}
function downloadCalendar(appointment) {
  const start = `${appointment.date.replace(/-/g, '')}T${appointment.time.replace(':', '')}00`;
  const endDate = new Date(`${appointment.date}T${appointment.time}:00`);
  endDate.setMinutes(endDate.getMinutes() + appointment.duration);
  const end = `${toKey(endDate).replace(/-/g, '')}T${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${appointment.id}@filo`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${appointment.serviceName} en Filo`, `LOCATION:Av. Reforma 245, Centro`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  link.download = `cita-filo-${appointment.date}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function joinWaitlist() {
  const key = `${state.currentUser.username}-${state.booking.barberId}-${state.booking.date}`;
  if (!state.waitlist.some(item => item.key === key)) {
    state.waitlist.push({ key, username: state.currentUser.username, clientName: state.currentUser.name, phone: state.currentUser.phone, barberId: state.booking.barberId, date: state.booking.date, createdAt: Date.now() });
    await saveWaitlist();
  }
  alert('Te añadimos a la lista de espera. Te avisaremos si se libera un horario.');
}

function renderApp() {
  const app = document.getElementById('app'); app.innerHTML = '';
  app.appendChild(renderHeader());
  if (state.currentUser && ['dashboard', 'my-appointments'].includes(state.view)) app.appendChild(renderTabNav());
  const main = document.createElement('main'); main.appendChild(renderView()); app.appendChild(main);
  const footer = document.createElement('footer'); footer.textContent = 'Filo Barbería · Reserva sencilla, atención con estilo'; app.appendChild(footer);
}
function renderHeader() {
  const bar = el(`<header class="topbar"><a class="brand" href="#" aria-label="Ir al inicio"><span class="brand-mark">F</span><span class="brand-text">Filo<small>Barbería contemporánea</small></span></a></header>`);
  bar.querySelector('.brand').onclick = event => { event.preventDefault(); state.view = state.currentUser ? 'dashboard' : 'home'; renderApp(); };
  if (state.currentUser) {
    const user = el(`<div class="topbar-user"><span>Hola, ${escapeHtml(state.currentUser.name.split(' ')[0])}</span><button class="btn-logout">Salir</button></div>`);
    user.querySelector('.btn-logout').onclick = () => { state.currentUser = null; state.view = 'home'; renderApp(); };
    bar.appendChild(user);
  }
  return bar;
}
function renderTabNav() {
  const nav = el(`<nav class="tabnav" aria-label="Navegación principal"><button class="${state.view === 'dashboard' ? 'active' : ''}">✦ Agendar</button><button class="${state.view === 'my-appointments' ? 'active' : ''}">▣ Mis citas</button><button class="${state.view === 'profile' ? 'active' : ''}">◉ Perfil</button></nav>`);
  nav.children[0].onclick = () => { state.view = 'dashboard'; renderApp(); };
  nav.children[1].onclick = () => { state.view = 'my-appointments'; renderApp(); };
  nav.children[2].onclick = () => { state.view = 'profile'; renderApp(); };
  return nav;
}
function renderView() {
  return ({ loading: viewLoading, home: viewHome, login: viewLogin, register: viewRegister, dashboard: viewDashboard, profile: viewProfile, 'book-barber': viewBookBarber, 'book-service': viewBookService, 'book-datetime': viewBookDateTime, 'book-confirm': viewBookConfirm, 'book-done': viewBookDone, 'my-appointments': viewMyAppointments, 'barber-dashboard': viewBarberDashboard }[state.view] || viewHome)();
}
function viewLoading() { return el('<div class="center-wrap"><p class="helptext">Cargando tu espacio...</p></div>'); }
function viewHome() {
  const wrap = el(`<div><section class="hero-home"><div class="hero-content"><span class="eyebrow">Tu estilo, a tu hora</span><h1>Un buen corte cambia cómo te sientes.</h1><p>Reserva con tu barbero favorito y llega con todo listo. Sin llamadas, sin esperas.</p><div class="hero-actions"><button class="btn btn-primary" id="start">Reservar mi cita</button><button class="btn btn-secondary" id="login">Ya tengo cuenta</button><button class="btn btn-panel" id="barber-panel">Vista barbería</button></div></div></section><section class="home-info"><div class="info-item"><strong>Horario</strong><span>Lun - Sáb · 10:00 a 19:00</span></div><div class="info-item"><strong>Ubicación</strong><span>Av. Reforma 245, Centro</span></div><div class="info-item"><strong>Contacto</strong><span>55 1234 5678</span></div></section><section class="lookbook"><div class="section-heading"><div><span class="eyebrow">Inspiración</span><h2>Elige tu próximo estilo</h2></div><span class="muted">Trabajos Filo</span></div><div class="lookbook-grid"><img src="https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=600&q=85" alt="Corte fade con textura"><img src="https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=85" alt="Arreglo profesional de barba"><img src="https://images.unsplash.com/photo-1593702295094-aea8c5f9f7d5?auto=format&fit=crop&w=600&q=85" alt="Corte clásico de barbería"></div></section><section class="location-card"><div><span class="eyebrow">Encuéntranos</span><h2>Tu próxima visita empieza aquí</h2><p>Av. Reforma 245, Centro · Lun - Sáb, 10:00 a 19:00</p></div><a class="btn btn-secondary" href="https://www.google.com/maps/search/?api=1&query=Av.+Reforma+245+Centro" target="_blank" rel="noreferrer">Cómo llegar ↗</a></section><div class="contact-strip"><div><strong>¿Tienes alguna pregunta?</strong><p>Escríbenos directamente por WhatsApp.</p></div><a href="https://wa.me/525512345678" target="_blank" rel="noreferrer">Abrir WhatsApp ↗</a></div></div>`);
  wrap.querySelector('#start').onclick = () => { state.view = state.currentUser ? 'book-barber' : 'register'; renderApp(); };
  wrap.querySelector('#login').onclick = () => { state.loginErrors = {}; state.view = 'login'; renderApp(); };
  wrap.querySelector('#barber-panel').onclick = () => { state.view = 'barber-dashboard'; renderApp(); };
  return wrap;
}
function fieldBlock(id, label, type, error, autocomplete, placeholder) {
  return el(`<div class="field${error ? ' field-error' : ''}"><label for="${id}">${label}</label><input type="${type}" id="${id}" autocomplete="${autocomplete || ''}" ${placeholder ? `placeholder="${placeholder}"` : ''}>${error ? `<div class="field-error-msg">${escapeHtml(error)}</div>` : ''}</div>`);
}
function backButton(view) { const row = el('<div class="back-row"><button class="link-back">← Volver</button></div>'); row.querySelector('button').onclick = () => { state.view = view; renderApp(); }; return row; }
function viewLogin() {
  const errors = state.loginErrors || {}; const wrap = el('<div class="center-wrap stack"></div>'); wrap.appendChild(backButton('home')); wrap.appendChild(el('<h2>Iniciar sesión</h2>')); wrap.appendChild(fieldBlock('l-user', 'Usuario', 'text', errors.user, 'username')); wrap.appendChild(fieldBlock('l-pass', 'Contraseña', 'password', errors.pass, 'current-password'));
  const login = el('<button class="btn btn-primary">Entrar</button>'); const register = el('<button class="btn btn-ghost">¿No tienes cuenta? Créala aquí</button>'); wrap.append(login, register);
  register.onclick = () => { state.registerErrors = {}; state.view = 'register'; renderApp(); };
  login.onclick = () => { const user = wrap.querySelector('#l-user').value.trim(); const pass = wrap.querySelector('#l-pass').value; const errors = {}; const account = state.accounts[user]; if (!user) errors.user = 'El usuario es obligatorio'; if (!pass) errors.pass = 'La contraseña es obligatoria'; if (user && pass && (!account || account.password !== pass)) { errors.user = 'Usuario o contraseña incorrectos'; errors.pass = 'Usuario o contraseña incorrectos'; } if (Object.keys(errors).length) { state.loginErrors = errors; renderApp(); return; } state.currentUser = { username: user, name: account.name, phone: account.phone }; state.view = 'dashboard'; renderApp(); };
  return wrap;
}
function viewRegister() {
  const errors = state.registerErrors || {}; const wrap = el('<div class="center-wrap stack"></div>'); wrap.appendChild(backButton('home')); wrap.appendChild(el('<h2>Crear mi cuenta</h2>')); wrap.appendChild(fieldBlock('r-name', 'Nombre completo', 'text', errors.name, 'name')); wrap.appendChild(fieldBlock('r-phone', 'Teléfono', 'tel', errors.phone, 'tel', '10 dígitos')); wrap.appendChild(fieldBlock('r-user', 'Usuario', 'text', errors.user, 'username')); wrap.appendChild(fieldBlock('r-pass', 'Contraseña', 'password', errors.pass, 'new-password')); wrap.appendChild(fieldBlock('r-pass2', 'Repite tu contraseña', 'password', errors.pass2, 'new-password'));
  const register = el('<button class="btn btn-primary">Crear cuenta</button>'); const login = el('<button class="btn btn-ghost">Ya tengo cuenta, iniciar sesión</button>'); wrap.append(register, login); login.onclick = () => { state.loginErrors = {}; state.view = 'login'; renderApp(); };
  register.onclick = async () => { const name = wrap.querySelector('#r-name').value.trim(); const phone = wrap.querySelector('#r-phone').value.trim(); const user = wrap.querySelector('#r-user').value.trim(); const pass = wrap.querySelector('#r-pass').value; const pass2 = wrap.querySelector('#r-pass2').value; const errors = {}; if (!name) errors.name = 'Tu nombre es obligatorio'; if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) errors.phone = 'Escribe un teléfono de 10 dígitos'; if (!user) errors.user = 'Elige un nombre de usuario'; else if (state.accounts[user]) errors.user = 'Ese usuario ya existe'; if (!pass || pass.length < 4) errors.pass = 'Usa al menos 4 caracteres'; if (!pass2 || pass !== pass2) errors.pass2 = 'Las contraseñas no coinciden'; if (Object.keys(errors).length) { state.registerErrors = errors; renderApp(); return; } state.accounts[user] = { name, phone, password: pass }; await saveAccounts(); state.currentUser = { username: user, name, phone }; state.view = 'dashboard'; renderApp(); };
  return wrap;
}
function viewDashboard() {
  const wrap = el('<div class="center-wrap stack"><div><span class="eyebrow">Panel personal</span><h1>¿Qué quieres hacer hoy?</h1><p class="muted">Reserva tu siguiente visita o revisa tus citas.</p></div><button class="btn btn-primary" id="book">+ Agendar una cita</button><div id="preview"></div></div>');
  wrap.querySelector('#book').onclick = () => { state.booking = { barberId: null, serviceId: null, date: null, time: null }; state.view = 'book-barber'; renderApp(); };
  const upcoming = state.appointments.filter(a => a.username === state.currentUser.username && a.status !== 'cancelada').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 2);
  if (upcoming.length) { const next = upcoming[0]; wrap.querySelector('#preview').append(el(`<div class="reminder-banner"><strong>Tu próxima visita está confirmada</strong><span>${escapeHtml(next.date)} a las ${escapeHtml(next.time)} · ${escapeHtml(next.serviceName)}</span></div>`)); wrap.querySelector('#preview').append(el('<h3 style="margin-top:12px;">Tus próximas citas</h3>')); const stack = el('<div class="stack"></div>'); upcoming.forEach(appt => stack.appendChild(renderApptCard(appt, false))); wrap.querySelector('#preview').appendChild(stack); }
  return wrap;
}
function viewProfile() {
  const account = state.accounts[state.currentUser.username];
  const wrap = el(`<div class="center-wrap stack"><div><span class="eyebrow">Tu espacio</span><h2>Mi perfil</h2><p class="muted">Actualiza tus datos y guarda tus preferencias.</p></div><div class="card profile-card"><div class="field"><label for="profile-name">Nombre completo</label><input type="text" id="profile-name" value="${escapeHtml(account.name)}"></div><div class="field"><label for="profile-phone">Teléfono</label><input type="tel" id="profile-phone" value="${escapeHtml(account.phone)}"></div><div class="field"><label for="profile-preference">Preferencia de corte</label><input type="text" id="profile-preference" placeholder="Ej. Fade bajo, barba corta"></div><div id="profile-message" class="helptext"></div><button class="btn btn-primary" id="save-profile">Guardar cambios</button></div><button class="btn btn-secondary" id="profile-home">Volver al inicio</button></div>`);
  wrap.querySelector('#save-profile').onclick = async () => {
    const name = wrap.querySelector('#profile-name').value.trim();
    const phone = wrap.querySelector('#profile-phone').value.trim();
    if (!name || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      wrap.querySelector('#profile-message').textContent = 'Revisa tu nombre y escribe un teléfono de 10 dígitos.';
      return;
    }
    state.accounts[state.currentUser.username] = { ...account, name, phone, preference: wrap.querySelector('#profile-preference').value.trim() };
    state.currentUser.name = name;
    state.currentUser.phone = phone;
    await saveAccounts();
    wrap.querySelector('#profile-message').textContent = 'Perfil actualizado correctamente.';
    renderApp();
  };
  wrap.querySelector('#profile-home').onclick = () => { state.view = 'dashboard'; renderApp(); };
  return wrap;
}
function viewBarberDashboard() {
  const todayKey = toKey(new Date());
  const todayLabel = `${DOW_NAMES[new Date().getDay()]} ${new Date().getDate()} de ${MONTH_NAMES[new Date().getMonth()]}`;
  const todayAppointments = state.appointments
    .filter(appointment => appointment.date === todayKey)
    .sort((a, b) => a.time.localeCompare(b.time));
  const activeAppointments = state.appointments.filter(appointment => appointment.status !== 'cancelada');
  const todayRevenue = todayAppointments
    .filter(appointment => appointment.status !== 'cancelada')
    .reduce((total, appointment) => total + appointment.price, 0);
  const wrap = el(`<div class="barber-panel"><div class="panel-heading"><div><span class="eyebrow">Vista interna</span><h1>Agenda de la barbería</h1><p class="muted">Resumen operativo para organizar el día.</p></div><button class="btn btn-secondary panel-back">← Volver al inicio</button></div><div class="metric-grid"><div class="metric-card"><span>Citas de hoy</span><strong>${todayAppointments.filter(appointment => appointment.status !== 'cancelada').length}</strong><small>${todayLabel}</small></div><div class="metric-card"><span>Reservas activas</span><strong>${activeAppointments.length}</strong><small>Todos los próximos días</small></div><div class="metric-card"><span>Ingresos de hoy</span><strong>$${todayRevenue}</strong><small>MXN confirmados</small></div></div><section class="card agenda-panel"><div class="section-heading"><div><span class="eyebrow">Agenda</span><h2>Turnos de hoy</h2></div><span class="status-dot"><i></i> En operación</span></div><div class="agenda-filters"><label>Barbero<select id="panel-barber-filter"><option value="todos">Todos</option>${BARBERS.map(barber => `<option value="${barber.id}" ${state.panelBarberFilter === barber.id ? 'selected' : ''}>${escapeHtml(barber.name)}</option>`).join('')}</select></label><label>Estado<select id="panel-status-filter"><option value="todos">Todos</option><option value="confirmada" ${state.panelStatusFilter === 'confirmada' ? 'selected' : ''}>Confirmadas</option><option value="cancelada" ${state.panelStatusFilter === 'cancelada' ? 'selected' : ''}>Canceladas</option></select></label></div><div class="agenda-list" id="agenda-list"></div></section></div>`);
  wrap.querySelector('.panel-back').onclick = () => { state.view = 'home'; renderApp(); };
  wrap.querySelector('#panel-barber-filter').onchange = event => { state.panelBarberFilter = event.target.value; renderApp(); };
  wrap.querySelector('#panel-status-filter').onchange = event => { state.panelStatusFilter = event.target.value; renderApp(); };
  const list = wrap.querySelector('#agenda-list');
  const filteredAppointments = todayAppointments.filter(appointment => (state.panelBarberFilter === 'todos' || appointment.barberId === state.panelBarberFilter) && (state.panelStatusFilter === 'todos' || appointment.status === state.panelStatusFilter));
  if (!filteredAppointments.length) {
    list.appendChild(el('<div class="empty-state">No hay citas para hoy.<br>La agenda está libre.</div>'));
  } else {
    filteredAppointments.forEach(appointment => {
      const cancelled = appointment.status === 'cancelada';
      const row = el(`<div class="agenda-row ${cancelled ? 'is-cancelled' : ''}"><div class="agenda-time">${appointment.time}<small>${appointment.duration} min</small></div><div class="agenda-client"><strong>${escapeHtml(appointment.clientName || 'Cliente')}</strong><span>${escapeHtml(appointment.serviceName)} · ${escapeHtml(appointment.barberName)}</span></div><span class="badge ${cancelled ? 'badge-cancelled' : 'badge-confirmed'}">${cancelled ? 'Cancelada' : appointment.status === 'atendida' ? 'Atendida' : 'Confirmada'}</span><div class="agenda-actions"></div></div>`);
      if (!cancelled) {
        const attended = el('<button class="btn btn-secondary">Atendida</button>');
        const absent = el('<button class="btn btn-danger">Ausente</button>');
        attended.onclick = async () => { appointment.status = 'atendida'; await saveAppointments(); renderApp(); };
        absent.onclick = async () => { appointment.status = 'ausente'; await saveAppointments(); renderApp(); };
        row.querySelector('.agenda-actions').append(attended, absent);
      }
      list.appendChild(row);
    });
  }
  return wrap;
}
function renderSteps(active) { const labels = ['Barbero', 'Servicio', 'Fecha y hora', 'Confirmar']; const wrap = el('<div></div>'); const dots = el('<div class="steps"></div>'); for (let i = 0; i < 4; i++) dots.appendChild(el(`<div class="step-dot ${i === active ? 'active' : i < active ? 'done' : ''}"></div>`)); wrap.append(dots, el(`<div class="step-label">Paso ${active + 1} de 4 · ${labels[active]}</div>`)); return wrap; }
function viewBookBarber() { const wrap = el('<div class="center-wrap"></div>'); wrap.appendChild(backButton('dashboard')); wrap.appendChild(renderSteps(0)); wrap.appendChild(el('<h2>Elige tu barbero</h2>')); const grid = el('<div class="grid-cards"></div>'); BARBERS.forEach(barber => { const card = el(`<button class="option-card"><img class="avatar" src="${barber.photo}" alt="${escapeHtml(barber.name)}"><h3>${escapeHtml(barber.name)}</h3><div class="meta">${escapeHtml(barber.specialty)}</div></button>`); card.onclick = () => { state.booking.barberId = barber.id; state.view = 'book-service'; renderApp(); }; grid.appendChild(card); }); wrap.appendChild(grid); return wrap; }
function viewBookService() { const wrap = el('<div class="center-wrap"></div>'); wrap.appendChild(backButton('book-barber')); wrap.appendChild(renderSteps(1)); wrap.appendChild(el('<h2>Elige el servicio</h2>')); const grid = el('<div class="grid-cards two-col"></div>'); SERVICES.forEach(service => { const card = el(`<button class="option-card"><h3>${escapeHtml(service.name)}</h3><div class="meta">${service.duration} minutos</div><div class="price">$${service.price} MXN</div></button>`); card.onclick = () => { state.booking.serviceId = service.id; state.view = 'book-datetime'; renderApp(); }; grid.appendChild(card); }); wrap.appendChild(grid); return wrap; }
function viewBookDateTime() {
  const service = getCurrentService(); const wrap = el('<div class="center-wrap"></div>'); wrap.appendChild(backButton('book-service')); wrap.appendChild(renderSteps(2)); wrap.appendChild(el('<h2>Elige día y hora</h2>')); wrap.appendChild(el(`<p class="muted">Horarios disponibles para ${service.duration} minutos.</p>`)); const dates = el('<div class="date-scroll"></div>'); nextAvailableDates(14).forEach(date => { const key = toKey(date); const pill = el(`<button class="date-pill ${state.booking.date === key ? 'selected' : ''}"><div class="dow">${DOW_NAMES[date.getDay()]}</div><div class="num">${date.getDate()}</div><div class="dow">${MONTH_NAMES[date.getMonth()]}</div></button>`); pill.onclick = () => { state.booking.date = key; state.booking.time = null; renderApp(); }; dates.appendChild(pill); }); wrap.appendChild(dates); wrap.appendChild(el('<h2 style="margin-top:22px;">Horarios</h2>'));
  if (!state.booking.date) wrap.appendChild(el('<p class="helptext">Selecciona un día para consultar disponibilidad.</p>')); else { const available = generateTimeSlots().filter(time => isSlotAvailable(state.booking.barberId, state.booking.date, time, service.duration)); if (!available.length) { const wait = el('<div class="waitlist-box"><p class="helptext">No quedan horarios compatibles ese día.</p><button class="btn btn-secondary">Avisarme si se libera un lugar</button></div>'); wait.querySelector('button').onclick = joinWaitlist; wrap.appendChild(wait); } else { const slots = el('<div class="slot-grid"></div>'); available.forEach(time => { const button = el(`<button class="slot-btn ${state.booking.time === time ? 'selected' : ''}">${time}</button>`); button.onclick = () => { state.booking.time = time; renderApp(); }; slots.appendChild(button); }); wrap.appendChild(slots); } }
  const continueButton = el('<button class="btn btn-primary" style="margin-top:22px;">Continuar</button>'); continueButton.disabled = !(state.booking.date && state.booking.time); continueButton.onclick = () => { state.view = 'book-confirm'; renderApp(); }; wrap.appendChild(continueButton); return wrap;
}
function viewBookConfirm() { const barber = BARBERS.find(item => item.id === state.booking.barberId); const service = getCurrentService(); const date = new Date(`${state.booking.date}T00:00:00`); const dateLabel = `${DOW_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`; const rescheduling = state.reschedulingId; const wrap = el('<div class="center-wrap"></div>'); wrap.appendChild(backButton('book-datetime')); wrap.appendChild(renderSteps(3)); wrap.appendChild(el(`<h2>${rescheduling ? 'Confirma el cambio' : 'Confirma tu cita'}</h2>`)); wrap.appendChild(el(`<div class="card"><div class="summary-row"><span>Barbero</span><strong>${escapeHtml(barber.name)}</strong></div><div class="summary-row"><span>Servicio</span><strong>${escapeHtml(service.name)}</strong></div><div class="summary-row"><span>Día</span><strong>${dateLabel}</strong></div><div class="summary-row"><span>Hora</span><strong>${state.booking.time}</strong></div><div class="summary-row"><span>Total</span><strong>$${service.price} MXN</strong></div></div>`)); const confirm = el(`<button class="btn btn-primary" style="margin-top:18px;">${rescheduling ? 'Guardar nueva fecha' : 'Confirmar cita'}</button>`); confirm.onclick = async () => { const oldAppointment = rescheduling && state.appointments.find(item => item.id === rescheduling); const conflict = state.appointments.some(item => item.id !== rescheduling && item.barberId === barber.id && item.date === state.booking.date && item.time === state.booking.time && item.status !== 'cancelada'); if (conflict || !isSlotAvailable(barber.id, state.booking.date, state.booking.time, service.duration) && !oldAppointment) { alert('Ese horario acaba de ocuparse. Elige otro.'); state.view = 'book-datetime'; renderApp(); return; } const appointment = oldAppointment || { id: `a${Date.now()}`, username: state.currentUser.username, clientName: state.currentUser.name, phone: state.currentUser.phone, status: 'confirmada' }; Object.assign(appointment, { barberId: barber.id, barberName: barber.name, serviceId: service.id, serviceName: service.name, price: service.price, duration: service.duration, date: state.booking.date, time: state.booking.time }); if (!oldAppointment) state.appointments.push(appointment); await saveAppointments(); state.reschedulingId = null; state.justCreatedId = appointment.id; state.view = 'book-done'; renderApp(); }; wrap.appendChild(confirm); return wrap; }
function viewBookDone() { const appointment = state.appointments.find(item => item.id === state.justCreatedId); const wrap = el('<div class="center-wrap stack" style="text-align:center;"><div class="confirm-icon">✓</div><h1>Cita creada</h1><p class="helptext">Te esperamos en Filo. Guarda estos datos para tu visita.</p></div>'); if (appointment) wrap.appendChild(renderApptCard(appointment, false)); const appointments = el('<button class="btn btn-primary">Ver mis citas</button>'); const home = el('<button class="btn btn-secondary">Volver al inicio</button>'); appointments.onclick = () => { state.view = 'my-appointments'; renderApp(); }; home.onclick = () => { state.view = 'dashboard'; renderApp(); }; wrap.append(appointments, home); return wrap; }
function renderApptCard(appointment, withCancel) { const date = new Date(`${appointment.date}T00:00:00`); const dateLabel = `${DOW_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`; const cancelled = appointment.status === 'cancelada'; const attended = appointment.status === 'atendida'; const absent = appointment.status === 'ausente'; const statusLabel = cancelled ? 'Cancelada' : attended ? 'Atendida' : absent ? 'Ausente' : 'Confirmada'; const card = el(`<article class="appt-card ${cancelled ? 'is-cancelled' : ''}"><div class="appt-card-top"><h3>${escapeHtml(appointment.serviceName)} con ${escapeHtml(appointment.barberName)}</h3><span class="badge ${cancelled ? 'badge-cancelled' : 'badge-confirmed'}">${statusLabel}</span></div><div class="meta">${dateLabel} · ${appointment.time} hrs · $${appointment.price} MXN</div></article>`); if (!cancelled) { const actions = el('<div class="appt-actions"></div>'); const calendar = el('<button class="btn btn-secondary">Agregar al calendario</button>'); calendar.onclick = () => downloadCalendar(appointment); actions.appendChild(calendar); if (withCancel) { const reschedule = el('<button class="btn btn-secondary">Reprogramar</button>'); reschedule.onclick = () => beginReschedule(appointment); const cancel = el('<button class="btn btn-danger">Cancelar cita</button>'); cancel.onclick = async () => { if (!confirm('¿Quieres cancelar esta cita?')) return; appointment.status = 'cancelada'; await saveAppointments(); renderApp(); }; actions.append(reschedule, cancel); } card.appendChild(actions); } return card; }
function viewMyAppointments() { const wrap = el('<div class="center-wrap stack"><div><span class="eyebrow">Historial</span><h2>Mis citas</h2></div></div>'); const mine = state.appointments.filter(item => item.username === state.currentUser.username).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); if (!mine.length) wrap.appendChild(el('<div class="empty-state">Todavía no tienes citas.<br>Usa “Agendar” para crear la primera.</div>')); else { const stack = el('<div class="stack"></div>'); mine.forEach(appointment => stack.appendChild(renderApptCard(appointment, true))); wrap.appendChild(stack); } return wrap; }

async function init() { renderApp(); await loadData(); state.view = 'home'; renderApp(); }
init();
