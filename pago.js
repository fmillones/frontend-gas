// URL del backend. En local apunta a localhost:3000; en producción, a tu servicio de Render.
const API_URL = 'https://backend-gas-xx35.onrender.com';

const cargando = document.getElementById('cargando');
const errorCuenta = document.getElementById('errorCuenta');
const contenido = document.getElementById('contenido');
const opciones = document.getElementById('opciones');
const redirigiendo = document.getElementById('redirigiendo');
const pagoSection = document.getElementById('pagoSection');
const pagoMsg = document.getElementById('pagoMsg');

let cuentaActual = null;
let scriptCargado = null; // promesa de carga de la librería (se carga una sola vez)

function formatoCLP(valor) {
  return valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
}

// ---------- 1) Cargar el detalle de la cuenta ----------
(async function init() {
  const dni = new URLSearchParams(window.location.search).get('dni');
  if (!dni) { window.location.replace('index.html'); return; }

  try {
    const r = await fetch(`${API_URL}/api/consulta-deuda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dni })
    });
    const data = await r.json();

    cargando.classList.add('d-none');
    if (!r.ok) {
      errorCuenta.textContent = data.error || 'No se pudo cargar la cuenta.';
      errorCuenta.classList.remove('d-none');
      return;
    }

    cuentaActual = data;
    document.getElementById('rNombre').textContent = data.nombre;
    document.getElementById('rRut').textContent = data.numeroCliente;
    document.getElementById('rDireccion').textContent = data.direccion;
    document.getElementById('rPeriodo').textContent = data.periodo;
    document.getElementById('rVencimiento').textContent = data.vencimiento;
    document.getElementById('rMonto').textContent = formatoCLP(data.monto);
    contenido.classList.remove('d-none');
  } catch (err) {
    cargando.classList.add('d-none');
    errorCuenta.textContent = 'Error de conexión con el servidor.';
    errorCuenta.classList.remove('d-none');
  }
})();

// ---------- Helpers de visibilidad ----------
function resetPago() {
  opciones.classList.remove('d-none');
  opciones.querySelectorAll('button').forEach((b) => (b.disabled = false));
  redirigiendo.classList.add('d-none');
  pagoSection.classList.add('d-none');
  pagoSection.classList.remove('pago-oculto');
  pagoSection.innerHTML = '';
  if (window.KR && window.KR.removeForms) window.KR.removeForms().catch(() => {});
}

// Oculta visualmente el formulario pero lo mantiene con layout real (opacity:0),
// para que el botón de Webpay se pueda presionar también en celulares y tablets
function ocultarFormulario() {
  pagoSection.classList.add('pago-oculto');
  pagoSection.classList.remove('d-none');
  redirigiendo.classList.remove('d-none');
}

function mostrarFormulario() {
  pagoSection.classList.remove('pago-oculto', 'd-none');
  redirigiendo.classList.add('d-none');
}

// ---------- 2) Elegir medio de pago (Mall o Plus) ----------
opciones.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-tienda]');
  if (!btn || !cuentaActual) return;
  const tienda = btn.dataset.tienda;

  opciones.querySelectorAll('button').forEach((b) => (b.disabled = true));
  pagoMsg.textContent = 'Generando pago…';
  pagoMsg.className = 'form-text text-muted text-center mt-2';

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
    pagoMsg.className = 'form-text text-danger text-center mt-2';
    resetPago();
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

// ---------- Auto-selección de Webpay ----------
// Solo considera elementos que mencionen Webpay en sus atributos, clases, texto o imágenes;
// nunca el botón de tarjeta. Si hay varios anidados, toma el más interno.
const RE_WEBPAY = /webpay|transbank/i;

function buscarBotonWebpay(contenedor) {
  const candidatos = Array.from(
    contenedor.querySelectorAll('button, a, [role="button"], [kr-payment-method], .kr-payment-button, .kr-smart-button')
  ).filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');

  const coinciden = candidatos.filter((el) => RE_WEBPAY.test(el.outerHTML));
  if (!coinciden.length) return null;

  coinciden.sort((a, b) => a.outerHTML.length - b.outerHTML.length);
  return coinciden[0];
}

// Espera (hasta 20 s: en celulares carga más lento) y presiona el botón de Webpay una sola vez
function autoPresionarWebpay(contenedor, timeoutMs = 20000) {
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
      setTimeout(revisar, 200);
    };

    revisar();
  });
}

async function montarFormularioPago(cfg, formToken, tienda) {
  // PayZen hace POST al backend (un sitio estático no puede recibirlo)
  const retorno = `${API_URL}/retorno-pago`;
  const autoPagar = tienda === 'plus';

  pagoSection.innerHTML = '<div id="krForm" class="kr-smart-form" kr-card-form-expanded></div>';

  if (autoPagar) ocultarFormulario();
  else mostrarFormulario();

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
      pagoMsg.className = 'form-text text-muted text-center mt-2';
      return;
    }

    // Si tras presionar no hubo redirección, se muestra el formulario como respaldo
    setTimeout(() => {
      if (document.visibilityState === 'visible' && pagoSection.classList.contains('pago-oculto')) {
        mostrarFormulario();
        pagoMsg.textContent = 'Si no fuiste redirigido, presiona la opción de Webpay.';
        pagoMsg.className = 'form-text text-muted text-center mt-2';
      }
    }, 7000);
  }
}