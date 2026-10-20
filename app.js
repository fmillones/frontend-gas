// URL del backend. En local apunta a localhost:3000; en producción, a tu servicio de Render.
const API_URL = 'https://backend-gas-xx35.onrender.com';

const consultaForm = document.getElementById('consultaForm');
const consultaMsg = document.getElementById('consultaMsg');
const btnConsultar = document.getElementById('btnConsultar');
const inputDni = document.getElementById('dni');

// Formato RUT chileno: xx.xxx.xxx-x (el último carácter es el dígito verificador, puede ser K)
function formatearRut(valor) {
  const limpio = valor.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
  if (limpio.length <= 1) return limpio;
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
}

inputDni.addEventListener('input', () => {
  inputDni.value = formatearRut(inputDni.value);
});

// Consulta la deuda y, si existe, abre la página de pago
consultaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dni = formatearRut(inputDni.value);
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
      btnConsultar.disabled = false;
      return;
    }

    window.location.href = 'pago.html?dni=' + encodeURIComponent(dni);
  } catch (err) {
    consultaMsg.textContent = 'Error de conexión con el servidor.';
    consultaMsg.className = 'form-text mt-2 text-danger';
    btnConsultar.disabled = false;
  }
});

// Si el usuario vuelve con el botón "atrás", se reactiva el botón
window.addEventListener('pageshow', () => { btnConsultar.disabled = false; });