// URL del backend. En local apunta a localhost:3000; en producción, a tu servicio de Render.
const API_URL = 'https://backend-gas-xx35.onrender.com';

const consultaForm = document.getElementById('consultaForm');
const consultaMsg = document.getElementById('consultaMsg');
const btnConsultar = document.getElementById('btnConsultar');
const opciones = document.getElementById('opciones');
const pagoSection = document.getElementById('pagoSection');
const pagoMsg = document.getElementById('pagoMsg');
const modalEl = document.getElementById('modalPago');
const modal = new bootstrap.Modal(modalEl);

let cuentaActual = null;
let scriptCargado = null; // promesa de carga de la librería (se carga una sola vez)

function formatoCLP(valor) {
  return valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
}

function mostrarFormulario() {
  pagoSection.style.position = '';
  pagoSection.style.left = '';
  pagoSection.style.top = '';
  pagoSection.style.width = '';
  pagoSection.style.visibility = '';
}

// Saca el formulario de la pantalla sin quitarlo del layout ni del DOM,
// para que PayZen lo dibuje normalmente y se pueda presionar su botón
function ocultarFormulario() {
  pagoSection.style.position = 'absolute';
  pagoSection.style.left = '-9999px';
  pagoSection.style.top = '0';
  pagoSection.style.width = '420px';
  pagoSection.style.visibility = 'hidden';
}

function resetPopup() {
  opciones.classList.remove('d-none');
  opciones.querySelectorAll('button').forEach((b) => (b.disabled = false));
  pagoSection.classList.add('d-none');
  pagoSection.innerHTML = '';
  mostrarFormulario();
  pagoMsg.textContent = '';
  pagoMsg.className = 'form-text text-danger mt-2';
  if (window.KR && window.KR.removeForms) window.KR.removeForms().catch(() => {});
}

// Al cerrar el popup se vuelve al paso de elegir medio de pago
modalEl.addEventListener('hidden.bs.modal', resetPopup);

// 1) Consultar deuda y abrir el popup
consultaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dni = document.getElementById('dni').value.trim();
  consultaMsg.textContent = 'Consultando…';
  consultaMsg.className = 'form-text mt-2';
  btnConsultar.disabled = true;

  try {
    const r = await fetch(`${API_URL}/api/consulta-deuda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dni })
    });
    const data = await r.json();

    if (!r.ok) {
      consultaMsg.textContent = data.error;
      consultaMsg.className = 'form-text mt-2 text-danger';
      return;
    }

    cuentaActual = data;
    consultaMsg.textContent = '';
    document.getElementById('rNombre').textContent = data.nombre;
    document.getElementById('rDireccion').textContent = data.direccion;
    document.getElementById('rPeriodo').textContent = data.periodo;
    document.getElementById('rVencimiento').textContent = data.vencimiento;
    document.getElementById('rMonto').textContent = formatoCLP(data.monto);
    resetPopup();
    modal.show();
  } catch (err) {
    consultaMsg.textContent = 'Error de conexión con el servidor.';
    consultaMsg.className = 'form-text mt-2 text-danger';
  } finally {
    btnConsultar.disabled = false;
  }
});

// 2) Elegir medio de pago (Mall o Plus)
opciones.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-tienda]');
  if (!btn || !cuentaActual) return;
  const tienda = btn.dataset.tienda;

  opciones.querySelectorAll('button').forEach((b) => (b.disabled = true));
  pagoMsg.textContent = 'Generando pago…';
  pagoMsg.className = 'form-text text-muted mt-2';

  try {
    const [cfgRes, pagoRes] = await Promise.all([
      fetch(`${API_URL}/api/config?tienda=` + encodeURIComponent(tienda)),
      fetch(`${API_URL}/api/crear-pago`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: cuentaActual.numeroCliente, tienda })
      })
    ]);
    const cfg = await cfgRes.json();
    const pago = await pagoRes.json();

    if (!cfgRes.ok || !pagoRes.ok) {
      throw new Error((pago && pago.error) || (cfg && cfg.error) || 'No se pudo iniciar el pago.');
    }

    // Se ocultan los botones y aparece el formulario
    opciones.classList.add('d-none');
    pagoMsg.textContent = '';
    await montarFormularioPago(cfg, pago.formToken, tienda);
  } catch (err) {
    pagoMsg.textContent = err.message || 'Error al conectar con el servidor de pago.';
    pagoMsg.className = 'form-text text-danger mt-2';
    mostrarFormulario();
    opciones.classList.remove('d-none');
    opciones.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
});

function cargarScript(src, atributos = {}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    Object.entries(atributos).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

// La librería y el tema se cargan una sola vez; la clave pública de cada tienda
// se indica después con KR.setFormConfig
function cargarKrypton(cfg) {
  if (scriptCargado) return scriptCargado;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = cfg.themeCss;
  document.head.appendChild(css);

  scriptCargado = cargarScript(cfg.jsUrl, { 'kr-public-key': cfg.publicKey })
    .then(() => cargarScript(cfg.themeJs));

  scriptCargado.catch(() => { scriptCargado = null; });
  return scriptCargado;
}

// Busca el elemento clicable que corresponde a Webpay/Transbank.
// Solo considera elementos que mencionen Webpay en sus atributos, clases, texto o imágenes;
// nunca el botón de tarjeta. Si hay varios anidados, toma el más interno.
const RE_WEBPAY = /webpay|transbank/i;

function buscarBotonWebpay(contenedor) {
  const candidatos = Array.from(
    contenedor.querySelectorAll('button, a, [role="button"], [kr-payment-method], .kr-payment-button, .kr-smart-button')
  ).filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');

  const coinciden = candidatos.filter((el) => RE_WEBPAY.test(el.outerHTML));
  if (!coinciden.length) return null;

  // el que tiene menos HTML es el más específico (no un contenedor que agrupa varios medios)
  coinciden.sort((a, b) => a.outerHTML.length - b.outerHTML.length);
  return coinciden[0];
}

// Espera a que aparezca el botón de Webpay y lo presiona una sola vez.
// Devuelve true si lo presionó, false si no apareció a tiempo.
function autoPresionarWebpay(contenedor, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const inicio = Date.now();

    const revisar = () => {
      const boton = buscarBotonWebpay(contenedor);
      if (boton) {
        console.log('[Webpay] Botón encontrado, presionando:', boton);
        boton.click();
        return resolve(true);
      }
      if (Date.now() - inicio >= timeoutMs) {
        console.warn('[Webpay] No se encontró el botón. HTML del formulario:\n', contenedor.innerHTML);
        return resolve(false);
      }
      setTimeout(revisar, 250);
    };

    revisar();
  });
}

async function montarFormularioPago(cfg, formToken, tienda) {
  // PayZen hace POST al backend (un sitio estático no puede recibirlo)
  const retorno = `${API_URL}/retorno-pago`;
  const autoPagar = tienda === 'plus';

  pagoSection.innerHTML = '<div id="krForm" class="kr-smart-form" kr-card-form-expanded></div>';
  pagoSection.classList.remove('d-none');

  if (autoPagar) {
    ocultarFormulario();
    pagoMsg.textContent = 'Redirigiendo a Webpay…';
    pagoMsg.className = 'form-text text-muted mt-2';
  } else {
    mostrarFormulario();
  }

  await cargarKrypton(cfg);

  // setFormConfig ya renderiza el formulario; no llamar a KR.renderElements
  await window.KR.setFormConfig({
    'kr-public-key': cfg.publicKey,
    'kr-post-url-success': retorno,
    'kr-post-url-refused': retorno,
    'kr-language': 'es-ES',
    formToken
  });

  if (autoPagar) {
    const ok = await autoPresionarWebpay(pagoSection);
    if (!ok) {
      // No se encontró el botón: se muestra el formulario para pagar manualmente
      mostrarFormulario();
      pagoMsg.textContent = 'Presiona la opción de Webpay para continuar con el pago.';
      pagoMsg.className = 'form-text text-muted mt-2';
    }
  }
}