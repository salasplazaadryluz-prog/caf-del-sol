async function checkAuth(){
const r = await fetch('/api/me');
const j = await r.json();
const el = document.getElementById('auth-links');
if (!j.user) {
el.innerHTML = '<a href="/login.html">Login</a> <a href="/register.html">Registro</a>'; 
return;
}
const user = j.user;
let extra = '';
if (user.role === 'admin') extra = '<a href="/admin.html">Admin</a>';
el.innerHTML = `Hola ${user.nombre} ${extra} <a id="logout" 
href="#">Cerrar</a>`;
document.getElementById('logout').addEventListener('click', async (e)=>{
e.preventDefault();
await fetch('/api/logout', { method: 'POST' });
location.reload();
});
}
checkAuth();


