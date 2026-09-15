(function () {
  let token = localStorage.getItem('token') || null;
  let currentUser = null;
  let dashboards = [];
  let budgetAccess = 'none';
  let budgetEntries = [];
  let editingBudgetId = null;
  let editingUserId = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const BRAND_LABEL = { ghelplus: 'GhelPlus', debacco: 'De Bacco' };
  const fmtMoney = (n) => n === null || n === undefined || n === ''
    ? '—'
    : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
    return data;
  }

  function showScreen(name) {
    ['loading', 'setup', 'login', 'app'].forEach((s) => {
      $('#screen-' + s).hidden = s !== name;
    });
  }

  function showView(name) {
    $all('.view').forEach((v) => (v.hidden = true));
    $('#view-' + name).hidden = false;
    $all('.navlink').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'budget') loadBudget();
    if (name === 'users') loadUsers();
  }

  // ---------- boot ----------
  async function boot() {
    if (token) {
      try {
        const data = await api('/api/auth/me');
        currentUser = data.user;
        await startApp();
        return;
      } catch (e) {
        token = null;
        localStorage.removeItem('token');
      }
    }
    try {
      const status = await fetch('/api/auth/status').then((r) => r.json());
      showScreen(status.needsSetup ? 'setup' : 'login');
    } catch (e) {
      showScreen('login');
    }
  }

  async function startApp() {
    $('#topbarUserName').textContent = currentUser.name || currentUser.username;
    $('#navUsers').hidden = !currentUser.isSuperAdmin;
    showScreen('app');
    await loadHome();
    showView('home');
  }

  $('#setupSubmit').onclick = async () => {
    const name = $('#setupName').value.trim();
    const username = $('#setupUsername').value.trim();
    const password = $('#setupPassword').value;
    $('#setupError').hidden = true;
    try {
      const data = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ name, username, password }) });
      token = data.token; currentUser = data.user;
      localStorage.setItem('token', token);
      await startApp();
    } catch (e) {
      $('#setupError').textContent = e.message;
      $('#setupError').hidden = false;
    }
  };

  $('#loginSubmit').onclick = async () => {
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    $('#loginError').hidden = true;
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      token = data.token; currentUser = data.user;
      localStorage.setItem('token', token);
      await startApp();
    } catch (e) {
      $('#loginError').textContent = e.message;
      $('#loginError').hidden = false;
    }
  };
  $('#loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginSubmit').click(); });

  $('#logoutBtn').onclick = () => {
    token = null; currentUser = null;
    localStorage.removeItem('token');
    location.reload();
  };

  $all('.navlink').forEach((b) => (b.onclick = () => showView(b.dataset.view)));

  // ---------- home / dashboards ----------
  async function loadHome() {
    const data = await api('/api/dashboards');
    dashboards = data.dashboards;
    budgetAccess = data.budgetAccess;
    const grid = $('#dashboardGrid');
    grid.innerHTML = '';
    const accessible = dashboards.filter((d) => d.access !== 'none');
    if (accessible.length === 0) {
      grid.innerHTML = '<p class="muted">Você ainda não tem acesso a nenhum dashboard. Peça para um administrador liberar.</p>';
      return;
    }
    accessible.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'dash-card';
      card.innerHTML = `
        <h3>${d.label}</h3>
        <p>${d.description}</p>
        <span class="tag">${d.access === 'admin' ? 'Acesso admin' : 'Acesso editor'}</span>
        <button>Abrir dashboard →</button>
      `;
      card.querySelector('button').onclick = () => openDashboard(d.key);
      grid.appendChild(card);
    });
  }

  async function openDashboard(key) {
    try {
      const data = await api('/api/dashboards/launch/' + key);
      window.open(data.url, '_blank');
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- orçamento ----------
  function fillMonthSelect(sel) {
    sel.innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  }
  fillMonthSelect($('#budgetFormMonth'));

  function fillYearFilter() {
    const sel = $('#budgetFilterYear');
    const current = new Date().getFullYear();
    const years = [current - 1, current, current + 1];
    sel.innerHTML = '<option value="">Todos os anos</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  }
  fillYearFilter();

  async function loadBudget() {
    const canEdit = budgetAccess === 'editor' || budgetAccess === 'admin';
    $('#budgetNewBtn').hidden = !canEdit;
    if (budgetAccess === 'none') {
      $('#budgetTableBody').innerHTML = '';
      $('#budgetEmpty').hidden = false;
      $('#budgetEmpty').textContent = 'Você não tem acesso à aba de Orçamento.';
      return;
    }
    const params = new URLSearchParams();
    if ($('#budgetFilterBrand').value) params.set('brand', $('#budgetFilterBrand').value);
    if ($('#budgetFilterYear').value) params.set('year', $('#budgetFilterYear').value);
    const data = await api('/api/budget?' + params.toString());
    budgetEntries = data.entries.sort((a, b) => (a.year - b.year) || (a.month - b.month) || a.brand.localeCompare(b.brand));
    renderBudgetTable(canEdit);
    renderBudgetSummary();
  }
  $('#budgetFilterBrand').onchange = loadBudget;
  $('#budgetFilterYear').onchange = loadBudget;

  function renderBudgetSummary() {
    const totalPlan = budgetEntries.reduce((s, e) => s + (Number(e.planejado) || 0), 0);
    const totalReal = budgetEntries.reduce((s, e) => s + (Number(e.realizado) || 0), 0);
    $('#sumPlanejado').textContent = fmtMoney(totalPlan);
    $('#sumRealizado').textContent = fmtMoney(totalReal);
    $('#sumDiferenca').textContent = fmtMoney(totalReal - totalPlan);
  }

  function renderBudgetTable(canEdit) {
    const body = $('#budgetTableBody');
    body.innerHTML = '';
    $('#budgetEmpty').hidden = budgetEntries.length > 0;
    if (budgetEntries.length === 0) $('#budgetEmpty').textContent = 'Nenhum lançamento ainda.';
    budgetEntries.forEach((e) => {
      const diff = (Number(e.realizado) || 0) - (Number(e.planejado) || 0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${BRAND_LABEL[e.brand] || e.brand}</td>
        <td>${e.category}</td>
        <td>${MONTHS[e.month - 1] || e.month}/${e.year}</td>
        <td class="num">${fmtMoney(e.planejado)}</td>
        <td class="num">${fmtMoney(e.realizado)}</td>
        <td class="num">${fmtMoney(diff)}</td>
        <td>${e.notes || ''}</td>
        <td></td>
      `;
      if (canEdit) {
        const actionsTd = tr.querySelector('td:last-child');
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Editar';
        editBtn.onclick = () => openBudgetForm(e);
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Excluir';
        delBtn.className = 'danger';
        delBtn.onclick = () => deleteBudgetEntry(e.id);
        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(delBtn);
      }
      body.appendChild(tr);
    });
  }

  function openBudgetForm(entry) {
    editingBudgetId = entry ? entry.id : null;
    $('#budgetFormTitle').textContent = entry ? 'Editar lançamento' : 'Novo lançamento';
    $('#budgetFormBrand').value = entry ? entry.brand : 'ghelplus';
    $('#budgetFormCategory').value = entry ? entry.category : '';
    $('#budgetFormYear').value = entry ? entry.year : new Date().getFullYear();
    $('#budgetFormMonth').value = entry ? entry.month : new Date().getMonth() + 1;
    $('#budgetFormPlanejado').value = entry && entry.planejado !== null ? entry.planejado : '';
    $('#budgetFormRealizado').value = entry && entry.realizado !== null ? entry.realizado : '';
    $('#budgetFormNotes').value = entry ? entry.notes || '' : '';
    $('#budgetFormError').hidden = true;
    $('#budgetFormWrap').hidden = false;
  }
  $('#budgetNewBtn').onclick = () => openBudgetForm(null);
  $('#budgetFormCancel').onclick = () => { $('#budgetFormWrap').hidden = true; };

  $('#budgetFormSave').onclick = async () => {
    const payload = {
      brand: $('#budgetFormBrand').value,
      category: $('#budgetFormCategory').value.trim(),
      year: $('#budgetFormYear').value,
      month: $('#budgetFormMonth').value,
      planejado: $('#budgetFormPlanejado').value,
      realizado: $('#budgetFormRealizado').value,
      notes: $('#budgetFormNotes').value.trim()
    };
    try {
      if (editingBudgetId) {
        await api('/api/budget/' + editingBudgetId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/budget', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#budgetFormWrap').hidden = true;
      await loadBudget();
    } catch (e) {
      $('#budgetFormError').textContent = e.message;
      $('#budgetFormError').hidden = false;
    }
  };

  async function deleteBudgetEntry(id) {
    if (!confirm('Excluir este lançamento?')) return;
    try {
      await api('/api/budget/' + id, { method: 'DELETE' });
      await loadBudget();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- usuários (super admin) ----------
  async function loadUsers() {
    if (!currentUser.isSuperAdmin) return;
    const data = await api('/api/auth/users');
    const body = $('#usersTableBody');
    body.innerHTML = '';
    data.users.forEach((u) => {
      const accessList = u.isSuperAdmin
        ? 'Tudo (admin da plataforma)'
        : Object.entries(u.permissions).filter(([, v]) => v !== 'none').map(([k, v]) => `${labelForKey(k)} (${v === 'admin' ? 'admin' : 'editor'})`).join(', ') || 'Nenhum';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.name}</td>
        <td>${u.username}</td>
        <td>${u.isSuperAdmin ? 'Administrador da plataforma' : 'Usuário'}</td>
        <td>${accessList}</td>
        <td></td>
      `;
      const actionsTd = tr.querySelector('td:last-child');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.onclick = () => openUserForm(u);
      actionsTd.appendChild(editBtn);
      if (u.id !== currentUser.id) {
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Excluir';
        delBtn.className = 'danger';
        delBtn.onclick = () => deleteUser(u.id);
        actionsTd.appendChild(delBtn);
      }
      body.appendChild(tr);
    });
  }

  function labelForKey(key) {
    return { trafegoPago: 'Tráfego Pago', acoesSazonais: 'Ações Sazonais', redesSociais: 'Redes Sociais', budget: 'Orçamento' }[key] || key;
  }

  function openUserForm(user) {
    editingUserId = user ? user.id : null;
    $('#userFormTitle').textContent = user ? 'Editar usuário' : 'Novo usuário';
    $('#userFormName').value = user ? user.name : '';
    $('#userFormUsername').value = user ? user.username : '';
    $('#userFormUsername').disabled = !!user;
    $('#userFormPassword').value = '';
    $('#userFormPasswordLabel').textContent = user ? 'Nova senha (deixe em branco para manter)' : 'Senha (mínimo 6 caracteres)';
    $('#userFormSuperAdmin').checked = user ? user.isSuperAdmin : false;
    const perms = (user && user.permissions) || { trafegoPago: 'none', acoesSazonais: 'none', redesSociais: 'none', budget: 'none' };
    $all('[data-perm]').forEach((sel) => { sel.value = perms[sel.dataset.perm] || 'none'; });
    $('#userFormError').hidden = true;
    $('#userFormWrap').hidden = false;
  }
  $('#userNewBtn').onclick = () => openUserForm(null);
  $('#userFormCancel').onclick = () => { $('#userFormWrap').hidden = true; };

  $('#userFormSave').onclick = async () => {
    const permissions = {};
    $all('[data-perm]').forEach((sel) => { permissions[sel.dataset.perm] = sel.value; });
    const payload = {
      name: $('#userFormName').value.trim(),
      username: $('#userFormUsername').value.trim(),
      password: $('#userFormPassword').value,
      isSuperAdmin: $('#userFormSuperAdmin').checked,
      permissions
    };
    try {
      if (editingUserId) {
        await api('/api/auth/users/' + editingUserId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        if (!payload.password || payload.password.length < 6) throw new Error('Informe uma senha com pelo menos 6 caracteres.');
        await api('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#userFormWrap').hidden = true;
      await loadUsers();
    } catch (e) {
      $('#userFormError').textContent = e.message;
      $('#userFormError').hidden = false;
    }
  };

  async function deleteUser(id) {
    if (!confirm('Excluir este usuário?')) return;
    try {
      await api('/api/auth/users/' + id, { method: 'DELETE' });
      await loadUsers();
    } catch (e) {
      alert(e.message);
    }
  }

  boot();
})();
