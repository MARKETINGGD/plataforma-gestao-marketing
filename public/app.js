(function () {
  let token = localStorage.getItem('token') || null;
  let currentUser = null;
  let dashboardsByKey = {};
  let budgetAccess = 'none';
  let budgetEntries = [];
  let budgetFluxos = [];
  let currentBudgetBrand = 'debacco';
  let budgetTab = 'geral';
  let editingBudgetId = null;
  let editingUserId = null;

  let teamMembers = [];
  let demandas = [];
  let demandasArchived = [];
  let showingArchived = false;
  let editingDemandaId = null;

  let brindesTab = 'debacco'; // 'debacco' | 'ghelplus' | 'log'
  let brindesCatalog = [];
  let brindesLog = [];
  let editingBrindeId = null;
  let editingBrindeLogId = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const BRAND_LABEL = { ghelplus: 'GhelPlus', debacco: 'De Bacco' };
  const STATUS_COLUMNS = [
    { key: 'a_fazer', label: 'A Fazer' },
    { key: 'andamento', label: 'Em Andamento' },
    { key: 'aprovacao', label: 'Em Aprovação' },
    { key: 'concluida', label: 'Concluída' }
  ];
  const fmtMoney = (n) => n === null || n === undefined || n === ''
    ? '—'
    : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers, body }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
    return data;
  }

  function showScreen(name) {
    ['loading', 'setup', 'login', 'app'].forEach((s) => {
      $('#screen-' + s).hidden = s !== name;
    });
  }

  function setActiveNav(id) {
    $all('.navlink').forEach((b) => b.classList.toggle('active', b.id === id));
  }

  function showView(name) {
    $all('.view').forEach((v) => (v.hidden = true));
    $('#view-' + name).hidden = false;
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
    try {
      const team = await api('/api/auth/team');
      teamMembers = team.users;
    } catch (e) { /* ignora */ }
    await loadHome();
    showView('home');
    setActiveNav('navHome');
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

  // ---------- navegação lateral ----------
  $all('.navlink').forEach((b) => {
    b.onclick = () => {
      setActiveNav(b.id);
      if (b.dataset.dash) {
        openDashboard(b.dataset.dash);
      } else if (b.dataset.view === 'budget') {
        openBudget(b.dataset.brand);
      } else {
        showView(b.dataset.view);
        if (b.dataset.view === 'demandas') loadDemandas();
        if (b.dataset.view === 'users') loadUsers();
        if (b.dataset.view === 'brindes') loadBrindes();
      }
    };
  });

  // ---------- Início ----------
  async function loadHome() {
    const data = await api('/api/dashboards');
    budgetAccess = data.budgetAccess;
    dashboardsByKey = {};
    data.dashboards.forEach((d) => { dashboardsByKey[d.key] = d; });
    $('#homeGreeting').textContent = 'Olá, ' + (currentUser.name || currentUser.username) + '! Resumo geral da sua agência.';

    try {
      const sum = await api('/api/demandas/summary');
      $('#statAtrasada').textContent = sum.summary.atrasada;
      $('#statAndamento').textContent = sum.summary.andamento;
      $('#statAprovacao').textContent = sum.summary.aprovacao;
      $('#statConcluida').textContent = sum.summary.concluida;
    } catch (e) { /* usuário pode não ter permissão futura — hoje é liberado a todos */ }

    if (budgetAccess !== 'none') {
      try {
        const year = new Date().getFullYear();
        const data = await api('/api/budget?year=' + year);
        const totalPlan = data.entries.reduce((s, e) => s + (Number(e.planejado) || 0), 0);
        const totalReal = data.entries.reduce((s, e) => s + (Number(e.realizado) || 0), 0);
        $('#statBudgetPlanejado').textContent = fmtMoney(totalPlan);
        $('#statBudgetRealizado').textContent = fmtMoney(totalReal);
        $('#statBudgetDiferenca').textContent = fmtMoney(totalReal - totalPlan);
      } catch (e) { /* sem acesso */ }
    }
  }

  $('#homeGoDemandas').onclick = () => { $('#navDemandas').click(); };
  $all('[data-open-budget]').forEach((b) => {
    b.onclick = () => { setActiveNav(b.dataset.openBudget === 'debacco' ? 'navBudgetDebacco' : 'navBudgetGhelplus'); openBudget(b.dataset.openBudget); };
  });
  $all('[data-open-dash]').forEach((b) => {
    b.onclick = () => {
      setActiveNav(b.dataset.openDash === 'trafegoPago' ? 'navDashTrafego' : 'navDashMidias');
      openDashboard(b.dataset.openDash);
    };
  });

  // ---------- dashboards embutidos ----------
  async function openDashboard(key) {
    try {
      const d = dashboardsByKey[key];
      const data = await api('/api/dashboards/launch/' + key);
      $('#embedTitle').textContent = (d && d.label) || '';
      $('#embedFrame').src = data.url;
      showView('embed');
    } catch (e) {
      alert(e.message);
    }
  }
  $('#embedBack').onclick = () => {
    $('#embedFrame').src = 'about:blank';
    showView('home');
    setActiveNav('navHome');
  };

  // ---------- Orçamento ----------
  function fillMonthSelect(sel) {
    sel.innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  }
  fillMonthSelect($('#budgetFormMonth'));

  function fillYearFilter() {
    const sel = $('#budgetFilterYear');
    const current = new Date().getFullYear();
    const years = [current - 1, current, current + 1];
    sel.innerHTML = years.map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`).join('');
  }
  fillYearFilter();

  async function openBudget(brand) {
    currentBudgetBrand = brand;
    $('#budgetTitle').textContent = 'Orçamento — ' + (BRAND_LABEL[brand] || brand);
    showView('budget');
    if (budgetFluxos.length === 0) {
      try {
        const meta = await api('/api/budget/meta');
        budgetFluxos = meta.fluxos;
        $('#budgetFormCategory').innerHTML = budgetFluxos.map((f) => `<option value="${f}">${f}</option>`).join('');
      } catch (e) { /* sem acesso */ }
    }
    await loadBudget();
  }

  $all('.tab-btn[data-tab]').forEach((b) => {
    b.onclick = () => {
      budgetTab = b.dataset.tab;
      $all('.tab-btn[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      renderBudget();
    };
  });

  $('#budgetFilterYear').onchange = loadBudget;

  async function loadBudget() {
    const canEdit = budgetAccess === 'editor' || budgetAccess === 'admin';
    $('#budgetNewBtn').hidden = !canEdit;
    if (budgetAccess === 'none') {
      $('#budgetTableBody').innerHTML = '';
      $('#budgetEmpty').hidden = false;
      $('#budgetEmpty').textContent = 'Você não tem acesso à aba de Orçamento.';
      return;
    }
    const params = new URLSearchParams({ brand: currentBudgetBrand });
    if ($('#budgetFilterYear').value) params.set('year', $('#budgetFilterYear').value);
    const data = await api('/api/budget?' + params.toString());
    budgetEntries = data.entries.sort((a, b) => (a.year - b.year) || (a.month - b.month) || a.category.localeCompare(b.category));
    renderBudget();
  }

  function renderBudget() {
    const canEdit = budgetAccess === 'editor' || budgetAccess === 'admin';
    $('#budgetTableWrap').hidden = budgetTab === 'comparativo';
    $('#budgetComparativoWrap').hidden = budgetTab !== 'comparativo';
    $('#budgetNewBtn').hidden = !canEdit || budgetTab === 'comparativo';

    let rows = budgetEntries;
    if (budgetTab === 'planejado') rows = rows.filter((e) => e.planejado !== null && e.planejado !== undefined);
    if (budgetTab === 'realizado') rows = rows.filter((e) => e.realizado !== null && e.realizado !== undefined);

    const totalPlan = rows.reduce((s, e) => s + (Number(e.planejado) || 0), 0);
    const totalReal = rows.reduce((s, e) => s + (Number(e.realizado) || 0), 0);
    $('#sumPlanejado').textContent = fmtMoney(totalPlan);
    $('#sumRealizado').textContent = fmtMoney(totalReal);
    $('#sumDiferenca').textContent = fmtMoney(totalReal - totalPlan);

    const body = $('#budgetTableBody');
    body.innerHTML = '';
    $('#budgetEmpty').hidden = rows.length > 0;
    if (rows.length === 0) $('#budgetEmpty').textContent = 'Nenhum lançamento ainda.';
    rows.forEach((e) => {
      const diff = (Number(e.realizado) || 0) - (Number(e.planejado) || 0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
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

    if (budgetTab === 'comparativo') renderBudgetComparativo();
  }

  function renderBudgetComparativo() {
    const byFluxo = {};
    budgetEntries.forEach((e) => {
      if (!byFluxo[e.category]) byFluxo[e.category] = { planejado: 0, realizado: 0 };
      byFluxo[e.category].planejado += Number(e.planejado) || 0;
      byFluxo[e.category].realizado += Number(e.realizado) || 0;
    });
    const body = $('#budgetComparativoBody');
    body.innerHTML = '';
    const fluxosComDados = Object.keys(byFluxo);
    if (fluxosComDados.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="muted">Sem lançamentos para cruzar ainda.</td></tr>';
      return;
    }
    fluxosComDados.sort().forEach((fluxo) => {
      const v = byFluxo[fluxo];
      const diff = v.realizado - v.planejado;
      const pct = v.planejado > 0 ? (v.realizado / v.planejado * 100) : (v.realizado > 0 ? null : 0);
      const tr = document.createElement('tr');
      if (v.planejado > 0 && v.realizado > v.planejado) tr.classList.add('row-over');
      tr.innerHTML = `
        <td>${fluxo}</td>
        <td class="num">${fmtMoney(v.planejado)}</td>
        <td class="num">${fmtMoney(v.realizado)}</td>
        <td class="num">${fmtMoney(diff)}</td>
        <td class="num">${pct === null ? 'sem planejado' : pct.toFixed(0) + '%'}</td>
      `;
      body.appendChild(tr);
    });
  }

  function openBudgetForm(entry) {
    editingBudgetId = entry ? entry.id : null;
    $('#budgetFormTitle').textContent = entry ? 'Editar lançamento' : 'Novo lançamento';
    $('#budgetFormBrand').value = currentBudgetBrand;
    $('#budgetFormCategory').value = entry ? entry.category : (budgetFluxos[0] || '');
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
      category: $('#budgetFormCategory').value,
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

  // ---------- Acompanhamento de Demandas ----------
  async function loadDemandas() {
    fillAssigneeSelect();
    const [ativas, arquivadas] = await Promise.all([
      api('/api/demandas?archived=false'),
      api('/api/demandas?archived=true')
    ]);
    demandas = ativas.demandas;
    demandasArchived = arquivadas.demandas;
    renderKanban();
    renderArchived();
  }

  function fillAssigneeSelect() {
    const sel = $('#demCardAssignee');
    sel.innerHTML = '<option value="">Sem responsável</option>' +
      teamMembers.map((u) => `<option value="${u.id}">${u.name}</option>`).join('');
  }

  function renderKanban() {
    const board = $('#kanbanBoard');
    board.innerHTML = '';
    STATUS_COLUMNS.forEach((col, colIdx) => {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      const items = demandas.filter((d) => d.status === col.key);
      colEl.innerHTML = `<div class="kanban-col-header">${col.label} <span class="kanban-count">${items.length}</span></div>`;
      const list = document.createElement('div');
      list.className = 'kanban-list';
      items.forEach((d) => {
        const card = document.createElement('div');
        card.className = 'kanban-card' + (d.overdue ? ' overdue' : '');
        const doneCount = (d.checklist || []).filter((c) => c.done).length;
        const total = (d.checklist || []).length;
        card.innerHTML = `
          <div class="kanban-card-title">${d.title}</div>
          <div class="kanban-card-meta">
            ${d.dueDate ? `<span class="badge ${d.overdue ? 'badge-danger' : ''}">${fmtDate(d.dueDate)}</span>` : ''}
            ${d.assigneeName ? `<span class="badge">${d.assigneeName}</span>` : ''}
            ${total > 0 ? `<span class="badge">${doneCount}/${total}</span>` : ''}
          </div>
          <div class="kanban-card-move">
            <button class="btn-move" data-dir="-1" ${colIdx === 0 ? 'disabled' : ''}>◀</button>
            <button class="btn-move" data-dir="1" ${colIdx === STATUS_COLUMNS.length - 1 ? 'disabled' : ''}>▶</button>
          </div>
        `;
        card.querySelector('.kanban-card-title').onclick = () => openDemandaModal(d);
        $all('.btn-move', card).forEach((btn) => {
          btn.onclick = async (ev) => {
            ev.stopPropagation();
            const newIdx = colIdx + Number(btn.dataset.dir);
            if (newIdx < 0 || newIdx >= STATUS_COLUMNS.length) return;
            await api('/api/demandas/' + d.id, { method: 'PUT', body: JSON.stringify({ status: STATUS_COLUMNS[newIdx].key }) });
            await loadDemandas();
          };
        });
        list.appendChild(card);
      });
      colEl.appendChild(list);
      board.appendChild(colEl);
    });
  }

  function renderArchived() {
    const body = $('#archivedTableBody');
    body.innerHTML = '';
    demandasArchived.forEach((d) => {
      const tr = document.createElement('tr');
      const statusLabel = (STATUS_COLUMNS.find((c) => c.key === d.status) || {}).label || d.status;
      tr.innerHTML = `<td>${d.title}</td><td>${d.assigneeName || ''}</td><td>${statusLabel}</td><td></td>`;
      const actionsTd = tr.querySelector('td:last-child');
      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Desarquivar';
      restoreBtn.onclick = async () => { await api('/api/demandas/' + d.id + '/archive', { method: 'PUT', body: JSON.stringify({ archived: false }) }); await loadDemandas(); };
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir esta demanda definitivamente?')) return;
        await api('/api/demandas/' + d.id, { method: 'DELETE' });
        await loadDemandas();
      };
      actionsTd.appendChild(restoreBtn);
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  $('#demandasNewBtn').onclick = () => openDemandaModal(null);
  $('#demandasToggleArchived').onclick = () => {
    showingArchived = !showingArchived;
    $('#archivedWrap').hidden = !showingArchived;
    $('#demandasToggleArchived').textContent = showingArchived ? 'Ver quadro' : 'Ver arquivadas';
    $('#kanbanBoard').hidden = showingArchived;
  };

  function renderChecklist(demanda) {
    const wrap = $('#demChecklist');
    wrap.innerHTML = '';
    (demanda.checklist || []).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'checklist-item';
      row.innerHTML = `<label><input type="checkbox" ${item.done ? 'checked' : ''}> <span>${item.text}</span></label>`;
      row.querySelector('input').onchange = async (ev) => {
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ done: ev.target.checked }) });
        editingDemandaId = demanda.id;
        await refreshOpenDemanda();
      };
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'DELETE' });
        await refreshOpenDemanda();
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  function renderFiles(demanda) {
    const wrap = $('#demFiles');
    wrap.innerHTML = '';
    (demanda.files || []).forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener">${f.name}</a> <span class="muted">(${fmtBytes(f.size)})</span>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        await api(`/api/demandas/${demanda.id}/files/${f.id}`, { method: 'DELETE' });
        await refreshOpenDemanda();
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  let openDemandaCache = null;
  async function refreshOpenDemanda() {
    if (!editingDemandaId) return;
    const data = await api('/api/demandas?archived=' + (openDemandaCache && openDemandaCache.archived ? 'true' : 'false'));
    const fresh = data.demandas.find((d) => d.id === editingDemandaId);
    if (fresh) {
      openDemandaCache = fresh;
      renderChecklist(fresh);
      renderFiles(fresh);
    }
  }

  function openDemandaModal(demanda) {
    editingDemandaId = demanda ? demanda.id : null;
    openDemandaCache = demanda;
    $('#demCardTitle').value = demanda ? demanda.title : '';
    $('#demCardStatus').value = demanda ? demanda.status : 'a_fazer';
    $('#demCardDueDate').value = demanda ? (demanda.dueDate || '') : '';
    $('#demCardAssignee').value = demanda ? (demanda.assigneeId || '') : '';
    $('#demCardDescription').value = demanda ? (demanda.description || '') : '';
    $('#demCardError').hidden = true;
    $('#demChecklistInput').value = '';
    $('#demFileInput').value = '';
    renderChecklist(demanda || { checklist: [] });
    renderFiles(demanda || { files: [] });
    $('#demCardArchive').textContent = demanda && demanda.archived ? 'Desarquivar' : 'Arquivar';
    $('#demCardArchive').hidden = !demanda;
    $('#demCardDelete').hidden = !demanda;
    $('#demChecklistAdd').parentElement.style.display = demanda ? '' : 'none';
    $('#demFileInput').style.display = demanda ? '' : 'none';
    $('#demandaModal').hidden = false;
  }
  $('#demCardClose').onclick = () => { $('#demandaModal').hidden = true; loadDemandas(); };

  $('#demCardSave').onclick = async () => {
    const payload = {
      title: $('#demCardTitle').value.trim(),
      description: $('#demCardDescription').value,
      status: $('#demCardStatus').value,
      dueDate: $('#demCardDueDate').value || null,
      assigneeId: $('#demCardAssignee').value || null
    };
    if (!payload.title) {
      $('#demCardError').textContent = 'Dê um título para a demanda.';
      $('#demCardError').hidden = false;
      return;
    }
    try {
      if (editingDemandaId) {
        await api('/api/demandas/' + editingDemandaId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const created = await api('/api/demandas', { method: 'POST', body: JSON.stringify(payload) });
        editingDemandaId = created.demanda.id;
        openDemandaCache = created.demanda;
        openDemandaModal(created.demanda);
        await loadDemandas();
        return;
      }
      $('#demandaModal').hidden = true;
      await loadDemandas();
    } catch (e) {
      $('#demCardError').textContent = e.message;
      $('#demCardError').hidden = false;
    }
  };

  $('#demChecklistAdd').onclick = async () => {
    const text = $('#demChecklistInput').value.trim();
    if (!text || !editingDemandaId) return;
    await api(`/api/demandas/${editingDemandaId}/checklist`, { method: 'POST', body: JSON.stringify({ text }) });
    $('#demChecklistInput').value = '';
    await refreshOpenDemanda();
  };

  $('#demFileInput').onchange = async () => {
    const file = $('#demFileInput').files[0];
    if (!file || !editingDemandaId) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/demandas/${editingDemandaId}/files`, { method: 'POST', body: fd });
      $('#demFileInput').value = '';
      await refreshOpenDemanda();
    } catch (e) {
      alert(e.message);
    }
  };

  $('#demCardArchive').onclick = async () => {
    if (!editingDemandaId) return;
    const archiveNow = $('#demCardArchive').textContent === 'Arquivar';
    await api('/api/demandas/' + editingDemandaId + '/archive', { method: 'PUT', body: JSON.stringify({ archived: archiveNow }) });
    $('#demandaModal').hidden = true;
    await loadDemandas();
  };

  $('#demCardDelete').onclick = async () => {
    if (!editingDemandaId) return;
    if (!confirm('Excluir esta demanda definitivamente? Essa ação não pode ser desfeita.')) return;
    await api('/api/demandas/' + editingDemandaId, { method: 'DELETE' });
    $('#demandaModal').hidden = true;
    await loadDemandas();
  };

  // ---------- Brindes ----------
  $all('.tab-btn[data-brindes-tab]').forEach((b) => {
    b.onclick = () => {
      brindesTab = b.dataset.brindesTab;
      $all('.tab-btn[data-brindes-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $('#brindesCatalogWrap').hidden = brindesTab === 'log';
      $('#brindesLogWrap').hidden = brindesTab !== 'log';
      renderBrindes();
    };
  });

  async function loadBrindes() {
    const [catDebacco, catGhel, log] = await Promise.all([
      api('/api/brindes/catalog?brand=debacco'),
      api('/api/brindes/catalog?brand=ghelplus'),
      api('/api/brindes/log')
    ]);
    brindesCatalog = catDebacco.items.concat(catGhel.items);
    brindesLog = log.items;
    renderBrindes();
  }

  function renderBrindes() {
    if (brindesTab === 'log') {
      renderBrindesLog();
    } else {
      renderBrindesCatalog(brindesTab);
    }
  }

  function renderBrindesCatalog(brand) {
    const body = $('#brindesCatalogBody');
    body.innerHTML = '';
    const rows = brindesCatalog.filter((r) => r.brand === brand);
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.code || ''}</td>
        <td>${r.item}</td>
        <td class="num">${r.multiplo || ''}</td>
        <td class="num">${fmtMoney(r.valor)}</td>
        <td class="num">${r.estoquePR}</td>
        <td class="num">${r.estoqueSP}</td>
        <td class="num">${r.estoquePE}</td>
        <td class="num">${r.estoqueTotal}</td>
        <td>${r.status || ''}</td>
        <td></td>
      `;
      const actionsTd = tr.querySelector('td:last-child');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.onclick = () => openBrindeForm(r, brand);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir este item do catálogo?')) return;
        await api('/api/brindes/catalog/' + r.id, { method: 'DELETE' });
        await loadBrindes();
      };
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  function renderBrindesLog() {
    const body = $('#brindesLogBody');
    body.innerHTML = '';
    brindesLog.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${BRAND_LABEL[r.brand] || r.brand}</td>
        <td>${fmtDate(r.date)}</td>
        <td>${r.representante || ''}</td>
        <td>${r.cliente || ''}</td>
        <td class="num">${r.quantidade}</td>
        <td>${r.item}</td>
        <td>${r.motivo || ''}</td>
        <td></td>
      `;
      const actionsTd = tr.querySelector('td:last-child');
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir este registro?')) return;
        await api('/api/brindes/log/' + r.id, { method: 'DELETE' });
        await loadBrindes();
      };
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  function openBrindeForm(item, brand) {
    editingBrindeId = item ? item.id : null;
    const brandLabel = BRAND_LABEL[brand] || brand;
    const code = prompt('Código:', item ? item.code : '') ?? null;
    if (code === null) return;
    const name = prompt('Nome do item:', item ? item.item : '');
    if (!name) return;
    const multiplo = prompt('Múltiplo:', item ? item.multiplo : '1');
    const valor = prompt('Valor (R$):', item ? item.valor : '');
    const estoquePR = prompt('Estoque PR:', item ? item.estoquePR : '0');
    const estoqueSP = prompt('Estoque SP:', item ? item.estoqueSP : '0');
    const estoquePE = prompt('Estoque PE:', item ? item.estoquePE : '0');
    const status = prompt('Status:', item ? item.status : '');
    const payload = { brand, code, item: name, multiplo, valor, estoquePR, estoqueSP, estoquePE, status };
    const call = editingBrindeId
      ? api('/api/brindes/catalog/' + editingBrindeId, { method: 'PUT', body: JSON.stringify(payload) })
      : api('/api/brindes/catalog', { method: 'POST', body: JSON.stringify(payload) });
    call.then(loadBrindes).catch((e) => alert(e.message));
  }
  $('#brindesCatalogNewBtn').onclick = () => openBrindeForm(null, brindesTab === 'log' ? 'debacco' : brindesTab);

  function openBrindeLogForm() {
    const brand = prompt('Marca (debacco ou ghelplus):', 'debacco');
    if (!brand) return;
    const date = prompt('Data (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
    const representante = prompt('Representante:', '');
    const estado = prompt('Estado:', '');
    const cliente = prompt('Cliente:', '');
    const quantidade = prompt('Quantidade:', '1');
    const item = prompt('Item:', '');
    if (!item) return;
    const motivo = prompt('Motivo:', '');
    api('/api/brindes/log', { method: 'POST', body: JSON.stringify({ brand, date, representante, estado, cliente, quantidade, item, motivo }) })
      .then(loadBrindes)
      .catch((e) => alert(e.message));
  }
  $('#brindesLogNewBtn').onclick = openBrindeLogForm;

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
      const team = await api('/api/auth/team');
      teamMembers = team.users;
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
