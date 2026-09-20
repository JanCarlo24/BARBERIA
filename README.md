# Booking UI Lib
Librería para inyectar un widget de reservas en cualquier página web.

## Instalación (Uso local)
1. Copia esta carpeta dentro de tu proyecto.
2. Importa el CSS en tu `index.html`:
   `<link rel="stylesheet" href="./ruta/a/lib_barberia/src/style.css">`
3. Importa la clase en tu JavaScript:

```javascript
import { BookingTools } from './ruta/a/lib_barberia/src/index.js';

const gestor = new BookingTools({
  barbers: [...], 
  services: [...], 
  storagePrefix: 'mi-app'
});

gestor.mountBookingWidget('#tu-div-contenedor');
