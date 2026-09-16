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
  let labels = [];
  let labelSuggestedColors = [];
  let selectedAssigneeIds = new Set();
  let selectedLabelIds = new Set();
  let editingLabelColor = null;
  let demandasScope = 'geral'; // 'geral' | 'pessoal'

  let recadosForMe = [];
  let recadosAll = [];
  let recadoSuggestedColors = [];
  let selectedRecadoColor = null;
  let selectedRecadoTargetIds = new Set();

  let socialPosts = [];
  let socialPlatforms = [];
  let socialStatuses = [];
  let socialPostTypes = [];
  let socialVideoPostTypes = [];
  let socialVideoPlatforms = [];
  let editingSocialPostId = null;
  let socialTab = 'debacco'; // 'debacco' | 'ghelplus'
  let socialInvolvedIds = new Set();

  let cronogramaTab = 'calendario'; // 'calendario' | 'feed'
  let cronogramaFeedNetwork = 'ig_fb'; // 'ig_fb' | 'linkedin'
  let cronogramaBrand = 'debacco'; // 'debacco' | 'ghelplus'
  let cronogramaCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  let brindesTab = 'debacco'; // 'debacco' | 'ghelplus' | 'log'
  let brindesCatalog = [];
  let brindesLog = [];
  let editingBrindeId = null;
  let editingBrindeLogId = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const BRAND_LABEL = { ghelplus: 'GhelPlus', debacco: 'De Bacco' };
  const STATUS_COLUMNS = [
    { key: 'a_fazer', label: 'A Fazer' },
    { key: 'andamento', label: 'Em Andamento' },
    { key: 'aprovacao', label: 'Em Aprovação' },
    { key: 'concluida', label: 'Concluída' }
  ];
  const UNASSIGNED_COL = { id: '', name: 'Sem responsável' };
  const SOCIAL_PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', newsletter: 'Newsletter' };
  const SOCIAL_STATUS_LABEL = { rascunho: 'Rascunho', agendado: 'Agendado', publicado: 'Publicado' };
  const SOCIAL_POST_TYPE_LABEL = { feed: 'Feed', story: 'Story', reels: 'Reels', carrossel: 'Carrossel', video: 'Vídeo', live: 'Live', g_news: 'G-NEWS', contatto: 'Contatto' };
  // Tipo de newsletter tem nome diferente por marca — mesma coisa, nomes distintos.
  const NEWSLETTER_TYPE_BY_BRAND = { ghelplus: 'g_news', debacco: 'contatto' };
  const NORMAL_POST_TYPES = ['feed', 'story', 'reels', 'carrossel', 'video', 'live'];
  const CARGO_LABEL = { gerente: 'Gerente', analista: 'Analista', auxiliar: 'Auxiliar', coordenador: 'Coordenador(a)', designer: 'Designer', designer3d: 'Designer 3D', videomaker: 'Videomaker' };
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
    applyCronogramaAccess();
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

  // ---------- alterar a própria senha ----------
  $('#changePasswordBtn').onclick = () => {
    $('#changePasswordCurrent').value = '';
    $('#changePasswordNew').value = '';
    $('#changePasswordConfirm').value = '';
    $('#changePasswordError').hidden = true;
    $('#changePasswordSuccess').hidden = true;
    $('#changePasswordModal').hidden = false;
  };
  $('#changePasswordClose').onclick = () => { $('#changePasswordModal').hidden = true; };
  $('#changePasswordSave').onclick = async () => {
    const currentPassword = $('#changePasswordCurrent').value;
    const newPassword = $('#changePasswordNew').value;
    const confirmPassword = $('#changePasswordConfirm').value;
    $('#changePasswordError').hidden = true;
    $('#changePasswordSuccess').hidden = true;
    if (!currentPassword) {
      $('#changePasswordError').textContent = 'Informe sua senha atual.';
      $('#changePasswordError').hidden = false;
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      $('#changePasswordError').textContent = 'A nova senha precisa ter pelo menos 6 caracteres.';
      $('#changePasswordError').hidden = false;
      return;
    }
    if (newPassword !== confirmPassword) {
      $('#changePasswordError').textContent = 'A confirmação não bate com a nova senha.';
      $('#changePasswordError').hidden = false;
      return;
    }
    try {
      await api('/api/auth/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
      $('#changePasswordCurrent').value = '';
      $('#changePasswordNew').value = '';
      $('#changePasswordConfirm').value = '';
      $('#changePasswordSuccess').hidden = false;
    } catch (e) {
      $('#changePasswordError').textContent = e.message;
      $('#changePasswordError').hidden = false;
    }
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
        if (b.dataset.view === 'agendamento') loadSocialPosts();
        if (b.dataset.view === 'cronograma') loadCronograma();
      }
    };
  });

  // ---------- Início ----------
  async function loadHome() {
    const data = await api('/api/dashboards');
    budgetAccess = data.budgetAccess;
    dashboardsByKey = {};
    data.dashboards.forEach((d) => { dashboardsByKey[d.key] = d; });
    $('#homeGreeting').textContent = 'Olá, ' + (currentUser.name || currentUser.username) + '! Resumo geral da plataforma.';

    await loadRecados();

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

  // ---------- Recados (mural da tela Início) ----------
  function teamMemberName(id) {
    const u = teamMembers.find((m) => m.id === id);
    return u ? u.name : '(usuário removido)';
  }

  async function loadRecados() {
    try {
      const [forMe, all] = await Promise.all([api('/api/recados/for-me'), api('/api/recados')]);
      recadosForMe = forMe.recados;
      recadosAll = all.recados;
      recadoSuggestedColors = all.suggestedColors || [];
      renderRecadosForMe();
      renderRecadosAll();
    } catch (e) { /* ignora */ }
  }

  function renderRecadosForMe() {
    const wrap = $('#recadosForMe');
    wrap.innerHTML = '';
    if (recadosForMe.length === 0) {
      wrap.innerHTML = '<div class="recado-empty">Nenhum recado novo pra você.</div>';
      return;
    }
    recadosForMe.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'recado-card';
      card.style.borderLeftColor = r.color;
      card.innerHTML = `
        <div class="recado-card-text">${r.text}<span class="recado-card-meta">de ${r.createdByName}</span></div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = 'Marcar como lido';
      btn.onclick = async () => {
        await api('/api/recados/' + r.id + '/read', { method: 'PUT' });
        await loadRecados();
      };
      card.appendChild(btn);
      wrap.appendChild(card);
    });
  }

  function renderRecadosAll() {
    const body = $('#recadosAllBody');
    body.innerHTML = '';
    if (recadosAll.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Nenhum recado enviado ainda.</td></tr>';
      return;
    }
    recadosAll.forEach((r) => {
      const targets = (r.targetUserIds || []).map(teamMemberName);
      const readCount = (r.readBy || []).length;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="label-color-dot" style="background:${r.color}"></span></td>
        <td>${r.text}</td>
        <td>${r.createdByName}</td>
        <td>${targets.join(', ')}</td>
        <td>${readCount}/${targets.length}</td>
        <td></td>
      `;
      const actionsTd = tr.querySelector('td:last-child');
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir este recado?')) return;
        await api('/api/recados/' + r.id, { method: 'DELETE' });
        await loadRecados();
      };
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  $('#recadosToggleAll').onclick = () => {
    const wrap = $('#recadosAllWrap');
    wrap.hidden = !wrap.hidden;
    $('#recadosToggleAll').textContent = wrap.hidden ? 'Ver meus recados (enviados e recebidos)' : 'Esconder meus recados';
  };

  function renderRecadoColorSwatches() {
    const wrap = $('#recadoColors');
    wrap.innerHTML = '';
    recadoSuggestedColors.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (selectedRecadoColor === c ? ' selected' : '');
      sw.style.background = c;
      sw.onclick = () => { selectedRecadoColor = c; renderRecadoColorSwatches(); };
      wrap.appendChild(sw);
    });
  }

  function renderRecadoTargetChips() {
    const wrap = $('#recadoTargetList');
    wrap.innerHTML = '';
    if (teamMembers.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhum usuário cadastrado ainda.</span>';
      return;
    }
    teamMembers.forEach((u) => {
      const chip = document.createElement('label');
      chip.className = 'chip-toggle' + (selectedRecadoTargetIds.has(u.id) ? ' active' : '');
      chip.innerHTML = `<input type="checkbox" ${selectedRecadoTargetIds.has(u.id) ? 'checked' : ''}> ${u.name}`;
      chip.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) selectedRecadoTargetIds.add(u.id); else selectedRecadoTargetIds.delete(u.id);
        chip.classList.toggle('active', ev.target.checked);
      };
      wrap.appendChild(chip);
    });
  }

  $('#recadosNewBtn').onclick = () => {
    $('#recadoText').value = '';
    selectedRecadoColor = recadoSuggestedColors[0] || '#0079bf';
    selectedRecadoTargetIds = new Set();
    $('#recadoModalError').hidden = true;
    renderRecadoColorSwatches();
    renderRecadoTargetChips();
    $('#recadoModal').hidden = false;
  };
  $('#recadoModalClose').onclick = () => { $('#recadoModal').hidden = true; };

  $('#recadoSave').onclick = async () => {
    const text = $('#recadoText').value.trim();
    if (!text) {
      $('#recadoModalError').textContent = 'Escreva o recado.';
      $('#recadoModalError').hidden = false;
      return;
    }
    if (selectedRecadoTargetIds.size === 0) {
      $('#recadoModalError').textContent = 'Marque pelo menos uma pessoa pra ver o recado.';
      $('#recadoModalError').hidden = false;
      return;
    }
    try {
      await api('/api/recados', { method: 'POST', body: JSON.stringify({ text, color: selectedRecadoColor, targetUserIds: Array.from(selectedRecadoTargetIds) }) });
      $('#recadoModal').hidden = true;
      await loadRecados();
    } catch (e) {
      $('#recadoModalError').textContent = e.message;
      $('#recadoModalError').hidden = false;
    }
  };

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
  function assigneeName(id) {
    const u = teamMembers.find((m) => m.id === id);
    return u ? u.name : '(usuário removido)';
  }
  function statusLabel(key) {
    return (STATUS_COLUMNS.find((c) => c.key === key) || {}).label || key;
  }

  async function loadDemandas() {
    const [ativas, arquivadas, labelsData] = await Promise.all([
      api('/api/demandas?archived=false&scope=' + demandasScope),
      api('/api/demandas?archived=true&scope=' + demandasScope),
      api('/api/labels')
    ]);
    demandas = ativas.demandas;
    demandasArchived = arquivadas.demandas;
    labels = labelsData.labels;
    labelSuggestedColors = labelsData.suggestedColors || [];
    renderKanban();
    renderArchived();
  }

  $all('.tab-btn[data-demandas-scope]').forEach((b) => {
    b.onclick = () => {
      demandasScope = b.dataset.demandasScope;
      $all('.tab-btn[data-demandas-scope]').forEach((x) => x.classList.toggle('active', x === b));
      $('#demandasScopeHint').textContent = demandasScope === 'pessoal'
        ? 'Só você e quem você marcar enxergam essas demandas.'
        : 'Visível para toda a equipe.';
      showingArchived = false;
      $('#archivedWrap').hidden = true;
      $('#kanbanBoard').hidden = false;
      $('#demandasToggleArchived').textContent = 'Ver arquivadas';
      loadDemandas();
    };
  });

  function labelById(id) { return labels.find((l) => l.id === id); }

  // No quadro geral, uma coluna por membro da equipe + "Sem responsável".
  // Na área pessoal, só aparecem colunas relevantes: eu (sempre primeiro) e
  // quem mais eu tiver marcado em alguma demanda pessoal visível pra mim.
  function kanbanColumns() {
    if (demandasScope === 'geral') return teamMembers.concat([UNASSIGNED_COL]);
    const me = { id: currentUser.id, name: (currentUser.name || currentUser.username) + ' (você)' };
    const others = new Set();
    demandas.forEach((d) => (d.assigneeIds || []).forEach((id) => { if (id !== currentUser.id) others.add(id); }));
    const otherCols = teamMembers.filter((m) => others.has(m.id));
    return [me].concat(otherCols);
  }

  function demandaInColumn(d, colId) {
    const ids = d.assigneeIds || [];
    if (demandasScope === 'pessoal' && ids.length === 0) return colId === currentUser.id;
    if (colId === '') return ids.length === 0;
    return ids.includes(colId);
  }

  function renderKanban() {
    const board = $('#kanbanBoard');
    board.innerHTML = '';
    const columns = kanbanColumns();
    columns.forEach((member) => {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      const items = demandas.filter((d) => demandaInColumn(d, member.id));
      colEl.innerHTML = `<div class="kanban-col-header"><span class="kanban-col-header-name">${member.name}</span><span class="kanban-count">${items.length}</span></div>`;
      const list = document.createElement('div');
      list.className = 'kanban-list';
      if (items.length === 0) {
        list.innerHTML = '<div class="kanban-empty">Sem demandas</div>';
      }
      items.forEach((d) => {
        const card = document.createElement('div');
        card.className = 'kanban-card' + (d.overdue ? ' overdue' : '');
        const doneCount = (d.checklist || []).filter((c) => c.done).length;
        const total = (d.checklist || []).length;
        const cardLabels = (d.labelIds || []).map(labelById).filter(Boolean);
        card.innerHTML = `
          ${cardLabels.length > 0 ? `<div class="kanban-card-labels">${cardLabels.map((l) => `<span class="kanban-label-chip" title="${l.name}" style="background:${l.color}"></span>`).join('')}</div>` : ''}
          <div class="kanban-card-title">${d.title}</div>
          <div class="kanban-card-meta">
            <span class="badge">${statusLabel(d.status)}</span>
            ${d.dueDate ? `<span class="badge ${d.overdue ? 'badge-danger' : ''}">${fmtDate(d.dueDate)}</span>` : ''}
            ${(d.assigneeIds || []).length > 1 ? `<span class="badge">${d.assigneeIds.length} pessoas</span>` : ''}
            ${total > 0 ? `<span class="badge">✓ ${doneCount}/${total}</span>` : ''}
            ${(d.files || []).length > 0 ? `<span class="badge">📎 ${d.files.length}</span>` : ''}
          </div>
        `;
        card.onclick = () => openDemandaModal(d);
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
      const names = (d.assigneeIds || []).map(assigneeName).join(', ');
      tr.innerHTML = `<td>${d.title}</td><td>${names}</td><td>${statusLabel(d.status)}</td><td></td>`;
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
    const list = demanda.checklist || [];
    const done = list.filter((c) => c.done).length;
    $('#demChecklistProgress').hidden = list.length === 0;
    if (list.length > 0) {
      $('#demChecklistProgressBar').style.width = Math.round((done / list.length) * 100) + '%';
    }
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

  function renderAssigneeChips() {
    const wrap = $('#demAssigneeList');
    wrap.innerHTML = '';
    if (teamMembers.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhum usuário cadastrado ainda.</span>';
      return;
    }
    teamMembers.forEach((u) => {
      const chip = document.createElement('label');
      chip.className = 'chip-toggle' + (selectedAssigneeIds.has(u.id) ? ' active' : '');
      chip.innerHTML = `<input type="checkbox" ${selectedAssigneeIds.has(u.id) ? 'checked' : ''}> ${u.name}`;
      chip.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) selectedAssigneeIds.add(u.id); else selectedAssigneeIds.delete(u.id);
        chip.classList.toggle('active', ev.target.checked);
      };
      wrap.appendChild(chip);
    });
  }

  function renderLabelChips() {
    const wrap = $('#demLabelList');
    wrap.innerHTML = '';
    if (labels.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhuma etiqueta ainda — clique em "gerenciar etiquetas" para criar.</span>';
      return;
    }
    labels.forEach((l) => {
      const chip = document.createElement('label');
      chip.className = 'chip-toggle label-chip' + (selectedLabelIds.has(l.id) ? ' active' : '');
      chip.style.background = l.color;
      chip.innerHTML = `<input type="checkbox" style="display:none;" ${selectedLabelIds.has(l.id) ? 'checked' : ''}> ${l.name}`;
      chip.onclick = (ev) => {
        ev.preventDefault();
        if (selectedLabelIds.has(l.id)) selectedLabelIds.delete(l.id); else selectedLabelIds.add(l.id);
        chip.classList.toggle('active', selectedLabelIds.has(l.id));
      };
      wrap.appendChild(chip);
    });
  }

  function openDemandaModal(demanda) {
    editingDemandaId = demanda ? demanda.id : null;
    openDemandaCache = demanda;
    selectedAssigneeIds = new Set(demanda ? (demanda.assigneeIds || []) : []);
    selectedLabelIds = new Set(demanda ? (demanda.labelIds || []) : []);
    $('#demCardTitle').value = demanda ? demanda.title : '';
    $('#demCardStatus').value = demanda ? demanda.status : 'a_fazer';
    $('#demCardDueDate').value = demanda ? (demanda.dueDate || '') : '';
    $('#demCardDescription').value = demanda ? (demanda.description || '') : '';
    $('#demCardError').hidden = true;
    $('#demChecklistInput').value = '';
    $('#demFileInput').value = '';
    renderAssigneeChips();
    renderLabelChips();
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
      assigneeIds: Array.from(selectedAssigneeIds),
      labelIds: Array.from(selectedLabelIds),
      visibility: demandasScope
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

  // ---------- Etiquetas (gerenciamento) ----------
  function renderColorSwatches() {
    const wrap = $('#labelNewColors');
    wrap.innerHTML = '';
    labelSuggestedColors.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (editingLabelColor === c ? ' selected' : '');
      sw.style.background = c;
      sw.onclick = () => { editingLabelColor = c; renderColorSwatches(); };
      wrap.appendChild(sw);
    });
  }

  function renderLabelManageList() {
    const wrap = $('#labelManageList');
    wrap.innerHTML = '';
    if (labels.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhuma etiqueta criada ainda.</span>';
      return;
    }
    labels.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'label-manage-row';
      row.innerHTML = `<span class="label-color-dot" style="background:${l.color}"></span>`;
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = l.name;
      nameInput.onchange = async () => {
        try {
          await api('/api/labels/' + l.id, { method: 'PUT', body: JSON.stringify({ name: nameInput.value }) });
          await refreshLabels();
        } catch (e) { alert(e.message); }
      };
      row.appendChild(nameInput);
      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = l.color;
      colorPicker.onchange = async () => {
        try {
          await api('/api/labels/' + l.id, { method: 'PUT', body: JSON.stringify({ color: colorPicker.value }) });
          await refreshLabels();
        } catch (e) { alert(e.message); }
      };
      row.appendChild(colorPicker);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        if (!confirm('Excluir a etiqueta "' + l.name + '"? Ela será removida de todos os cards.')) return;
        await api('/api/labels/' + l.id, { method: 'DELETE' });
        await refreshLabels();
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  async function refreshLabels() {
    const data = await api('/api/labels');
    labels = data.labels;
    labelSuggestedColors = data.suggestedColors || labelSuggestedColors;
    renderLabelManageList();
    renderLabelChips();
    renderKanban();
  }

  function openLabelModal() {
    editingLabelColor = labelSuggestedColors[labels.length % (labelSuggestedColors.length || 1)] || '#0079bf';
    $('#labelNewName').value = '';
    $('#labelModalError').hidden = true;
    renderLabelManageList();
    renderColorSwatches();
    $('#labelModal').hidden = false;
  }
  $('#demandasManageLabelsBtn').onclick = openLabelModal;
  $('#demLabelManageBtn').onclick = openLabelModal;
  $('#labelModalClose').onclick = () => { $('#labelModal').hidden = true; };

  $('#labelNewAdd').onclick = async () => {
    const name = $('#labelNewName').value.trim();
    if (!name) {
      $('#labelModalError').textContent = 'Dê um nome para a etiqueta.';
      $('#labelModalError').hidden = false;
      return;
    }
    try {
      await api('/api/labels', { method: 'POST', body: JSON.stringify({ name, color: editingLabelColor }) });
      $('#labelNewName').value = '';
      await refreshLabels();
    } catch (e) {
      $('#labelModalError').textContent = e.message;
      $('#labelModalError').hidden = false;
    }
  };

  // ---------- Agendamento para Redes Sociais ----------
  async function ensureSocialMeta() {
    if (socialPlatforms.length > 0) return;
    try {
      const meta = await api('/api/social-posts/meta');
      socialPlatforms = meta.platforms;
      socialStatuses = meta.statuses;
      socialPostTypes = meta.postTypes;
      socialVideoPostTypes = meta.videoPostTypes || [];
      socialVideoPlatforms = meta.videoPlatforms || [];
      $('#socialPostFormPlatform').innerHTML = socialPlatforms.map((p) => `<option value="${p}">${SOCIAL_PLATFORM_LABEL[p] || p}</option>`).join('');
    } catch (e) { /* ignora */ }
  }

  // O tipo de post depende da rede: pra Newsletter só existe 1 tipo, e o
  // nome muda por marca (G-NEWS na GhelPlus, Contatto na De Bacco). Pras
  // outras redes, mostra os tipos normais (Feed/Story/Reels/...).
  function updateSocialTypeOptions(keepValue) {
    const platform = $('#socialPostFormPlatform').value;
    const brand = $('#socialPostFormBrand').value || 'debacco';
    const sel = $('#socialPostFormType');
    let options;
    if (platform === 'newsletter') {
      options = [NEWSLETTER_TYPE_BY_BRAND[brand] || 'g_news'];
    } else {
      options = NORMAL_POST_TYPES;
    }
    sel.innerHTML = options.map((t) => `<option value="${t}">${SOCIAL_POST_TYPE_LABEL[t] || t}</option>`).join('');
    if (keepValue && options.includes(keepValue)) sel.value = keepValue;
    updateScriptVisibility();
  }

  // Roteiro só faz sentido quando o agendamento é de vídeo (Reels, ou
  // rede TikTok/YouTube).
  function updateScriptVisibility() {
    const platform = $('#socialPostFormPlatform').value;
    const type = $('#socialPostFormType').value;
    const isVideo = socialVideoPostTypes.includes(type) || socialVideoPlatforms.includes(platform);
    $('#socialPostFormScriptWrap').hidden = !isVideo;
  }

  $('#socialPostFormPlatform').onchange = () => updateSocialTypeOptions();
  $('#socialPostFormBrand').onchange = () => updateSocialTypeOptions($('#socialPostFormType').value);
  $('#socialPostFormType').onchange = () => updateScriptVisibility();

  $all('.tab-btn[data-social-tab]').forEach((b) => {
    b.onclick = () => {
      socialTab = b.dataset.socialTab;
      $all('.tab-btn[data-social-tab]').forEach((x) => x.classList.toggle('active', x === b));
      renderSocialPosts();
    };
  });

  async function loadSocialPosts() {
    await ensureSocialMeta();
    const data = await api('/api/social-posts');
    socialPosts = data.posts;
    renderSocialPosts();
  }

  function renderSocialPosts() {
    const body = $('#socialPostsBody');
    body.innerHTML = '';
    const rows = socialPosts.filter((p) => (p.brand || 'debacco') === socialTab);
    $('#socialPostsEmpty').hidden = rows.length > 0;
    rows.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${SOCIAL_PLATFORM_LABEL[p.platform] || p.platform}</td>
        <td>${SOCIAL_POST_TYPE_LABEL[p.postType] || p.postType || ''}</td>
        <td>${fmtDate(p.scheduledDate)}</td>
        <td>${p.scheduledTime || ''}</td>
        <td>${(p.caption || '').slice(0, 60)}${(p.caption || '').length > 60 ? '…' : ''}</td>
        <td><span class="badge">${SOCIAL_STATUS_LABEL[p.status] || p.status}</span></td>
        <td></td>
      `;
      const actionsTd = tr.querySelector('td:last-child');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.onclick = () => openSocialPostForm(p);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir este agendamento?')) return;
        await api('/api/social-posts/' + p.id, { method: 'DELETE' });
        await loadSocialPosts();
      };
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  function renderSocialPostFiles(post) {
    const wrap = $('#socialPostFormFiles');
    wrap.innerHTML = '';
    (post.files || []).forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener">${f.name}</a> <span class="muted">(${fmtBytes(f.size)})</span>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        await api(`/api/social-posts/${post.id}/files/${f.id}`, { method: 'DELETE' });
        const fresh = await api('/api/social-posts');
        socialPosts = fresh.posts;
        const updated = socialPosts.find((x) => x.id === post.id);
        if (updated) renderSocialPostFiles(updated);
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  function renderSocialLayoutFiles(post) {
    const wrap = $('#socialPostFormLayoutFiles');
    wrap.innerHTML = '';
    (post.layoutFiles || []).forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener">${f.name}</a> <span class="muted">(${fmtBytes(f.size)})</span>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        await api(`/api/social-posts/${post.id}/layout-files/${f.id}`, { method: 'DELETE' });
        const fresh = await api('/api/social-posts');
        socialPosts = fresh.posts;
        const updated = socialPosts.find((x) => x.id === post.id);
        if (updated) renderSocialLayoutFiles(updated);
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  // Renderiza um único arquivo (briefing ou roteiro) — mostra o arquivo
  // atual com botão de remover, ou nada se ainda não tiver anexo.
  function renderSocialSingleFile(wrapSel, file, deleteUrl, onDeleted) {
    const wrap = $(wrapSel);
    wrap.innerHTML = '';
    if (!file) return;
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `<a href="${file.url}" target="_blank" rel="noopener">${file.name}</a> <span class="muted">(${fmtBytes(file.size)})</span>`;
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.className = 'btn-link';
    delBtn.onclick = async () => {
      await api(deleteUrl, { method: 'DELETE' });
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      const updated = socialPosts.find((x) => x.id === editingSocialPostId);
      if (updated) onDeleted(updated);
    };
    row.appendChild(delBtn);
    wrap.appendChild(row);
  }

  function renderBriefingFile(post) {
    renderSocialSingleFile('#socialPostFormBriefingFile', post ? post.briefingFile : null, `/api/social-posts/${post ? post.id : ''}/briefing-file`, renderBriefingFile);
  }

  function renderScriptFile(post) {
    renderSocialSingleFile('#socialPostFormScriptFile', post ? post.scriptFile : null, `/api/social-posts/${post ? post.id : ''}/script-file`, renderScriptFile);
  }

  function renderInvolvedChips() {
    const wrap = $('#socialPostFormInvolvedList');
    wrap.innerHTML = '';
    if (teamMembers.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhum usuário cadastrado ainda.</span>';
      return;
    }
    teamMembers.forEach((u) => {
      const chip = document.createElement('label');
      chip.className = 'chip-toggle' + (socialInvolvedIds.has(u.id) ? ' active' : '');
      const cargoTag = u.cargo ? ` (${CARGO_LABEL[u.cargo] || u.cargo})` : '';
      chip.innerHTML = `<input type="checkbox" ${socialInvolvedIds.has(u.id) ? 'checked' : ''}> ${u.name}${cargoTag}`;
      chip.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) socialInvolvedIds.add(u.id); else socialInvolvedIds.delete(u.id);
        chip.classList.toggle('active', ev.target.checked);
      };
      wrap.appendChild(chip);
    });
  }

  function openSocialPostForm(post) {
    editingSocialPostId = post ? post.id : null;
    $('#socialPostFormTitle').textContent = post ? 'Editar agendamento' : 'Novo agendamento';
    $('#socialPostFormBrand').value = post ? (post.brand || 'debacco') : socialTab;
    $('#socialPostFormPlatform').value = post ? post.platform : (socialPlatforms[0] || '');
    updateSocialTypeOptions(post ? (post.postType || 'feed') : 'feed');
    $('#socialPostFormStatus').value = post ? post.status : 'rascunho';
    $('#socialPostFormDate').value = post ? post.scheduledDate : '';
    $('#socialPostFormTime').value = post ? (post.scheduledTime || '') : '';
    $('#socialPostFormCaption').value = post ? (post.caption || '') : '';
    $('#socialPostFormSuggestions').value = post ? (post.changeSuggestions || '') : '';
    $('#socialPostFormLink').value = post ? (post.link || '') : '';
    $('#socialPostFormBriefingLink').value = post ? (post.briefingLink || '') : '';
    $('#socialPostFormScriptLink').value = post ? (post.scriptLink || '') : '';

    socialInvolvedIds = new Set(post ? (post.involvedUserIds || []) : []);
    renderInvolvedChips();

    $('#socialPostFormFileInput').value = '';
    $('#socialPostFormFileInput').style.display = post ? '' : 'none';
    $('#socialPostFormLayoutFileInput').value = '';
    $('#socialPostFormLayoutFileInput').style.display = post ? '' : 'none';
    $('#socialPostFormBriefingFileInput').value = '';
    $('#socialPostFormBriefingFileInput').style.display = post ? '' : 'none';
    $('#socialPostFormScriptFileInput').value = '';
    $('#socialPostFormScriptFileInput').style.display = post ? '' : 'none';

    renderSocialPostFiles(post || { files: [] });
    renderSocialLayoutFiles(post || { layoutFiles: [] });
    renderBriefingFile(post);
    renderScriptFile(post);

    $('#socialPostFormError').hidden = true;
    $('#socialPostFormWrap').hidden = false;
  }
  $('#socialPostNewBtn').onclick = () => openSocialPostForm(null);
  $('#socialPostFormCancel').onclick = () => { $('#socialPostFormWrap').hidden = true; };

  $('#socialPostFormSave').onclick = async () => {
    const payload = {
      brand: $('#socialPostFormBrand').value,
      platform: $('#socialPostFormPlatform').value,
      status: $('#socialPostFormStatus').value,
      postType: $('#socialPostFormType').value,
      scheduledDate: $('#socialPostFormDate').value,
      scheduledTime: $('#socialPostFormTime').value,
      caption: $('#socialPostFormCaption').value,
      involvedUserIds: Array.from(socialInvolvedIds),
      changeSuggestions: $('#socialPostFormSuggestions').value,
      link: $('#socialPostFormLink').value,
      briefingLink: $('#socialPostFormBriefingLink').value,
      scriptLink: $('#socialPostFormScriptLink').value
    };
    if (!payload.scheduledDate) {
      $('#socialPostFormError').textContent = 'Escolha a data do agendamento.';
      $('#socialPostFormError').hidden = false;
      return;
    }
    try {
      if (editingSocialPostId) {
        await api('/api/social-posts/' + editingSocialPostId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const created = await api('/api/social-posts', { method: 'POST', body: JSON.stringify(payload) });
        editingSocialPostId = created.post.id;
        openSocialPostForm(created.post);
        await loadSocialPosts();
        return;
      }
      $('#socialPostFormWrap').hidden = true;
      await loadSocialPosts();
    } catch (e) {
      $('#socialPostFormError').textContent = e.message;
      $('#socialPostFormError').hidden = false;
    }
  };

  $('#socialPostFormFileInput').onchange = async () => {
    const file = $('#socialPostFormFileInput').files[0];
    if (!file || !editingSocialPostId) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/social-posts/${editingSocialPostId}/files`, { method: 'POST', body: fd });
      $('#socialPostFormFileInput').value = '';
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      const updated = socialPosts.find((x) => x.id === editingSocialPostId);
      if (updated) renderSocialPostFiles(updated);
    } catch (e) {
      alert(e.message);
    }
  };

  $('#socialPostFormLayoutFileInput').onchange = async () => {
    const files = Array.from($('#socialPostFormLayoutFileInput').files || []);
    if (files.length === 0 || !editingSocialPostId) return;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/api/social-posts/${editingSocialPostId}/layout-files`, { method: 'POST', body: fd });
      }
      $('#socialPostFormLayoutFileInput').value = '';
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      const updated = socialPosts.find((x) => x.id === editingSocialPostId);
      if (updated) renderSocialLayoutFiles(updated);
    } catch (e) {
      alert(e.message);
    }
  };

  $('#socialPostFormBriefingFileInput').onchange = async () => {
    const file = $('#socialPostFormBriefingFileInput').files[0];
    if (!file || !editingSocialPostId) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/social-posts/${editingSocialPostId}/briefing-file`, { method: 'POST', body: fd });
      $('#socialPostFormBriefingFileInput').value = '';
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      const updated = socialPosts.find((x) => x.id === editingSocialPostId);
      if (updated) renderBriefingFile(updated);
    } catch (e) {
      alert(e.message);
    }
  };

  $('#socialPostFormScriptFileInput').onchange = async () => {
    const file = $('#socialPostFormScriptFileInput').files[0];
    if (!file || !editingSocialPostId) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/social-posts/${editingSocialPostId}/script-file`, { method: 'POST', body: fd });
      $('#socialPostFormScriptFileInput').value = '';
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      const updated = socialPosts.find((x) => x.id === editingSocialPostId);
      if (updated) renderScriptFile(updated);
    } catch (e) {
      alert(e.message);
    }
  };

  // ---------- Cronograma de Marketing ----------
  // A aba Calendário fica restrita: todo mundo pode ver, exceto quem tem
  // cargo "Gerente" (pedido explícito da Raquel). A Prévia do Feed continua
  // aberta pra todo mundo. Como os dois usam os mesmos dados do Agendamento
  // (que quem tem cargo Gerente já enxerga por completo na Prévia do Feed
  // e no próprio Agendamento), essa é uma restrição de tela/fluxo de
  // trabalho, não uma restrição de dado sensível — por isso o bloqueio é só
  // no frontend, sem gate correspondente no backend.
  function applyCronogramaAccess() {
    const blocked = currentUser.cargo === 'gerente';
    $('#cronogramaTabCalendario').hidden = blocked;
    if (blocked) {
      cronogramaTab = 'feed';
      $all('.tab-btn[data-cronograma-tab]').forEach((x) => x.classList.toggle('active', x.dataset.cronogramaTab === 'feed'));
      $('#cronogramaCalendarioWrap').hidden = true;
      $('#cronogramaFeedWrap').hidden = false;
    }
  }

  $all('.tab-btn[data-cronograma-brand]').forEach((b) => {
    b.onclick = () => {
      cronogramaBrand = b.dataset.cronogramaBrand;
      $all('.tab-btn[data-cronograma-brand]').forEach((x) => x.classList.toggle('active', x === b));
      renderCronograma();
    };
  });
  $all('.tab-btn[data-cronograma-tab]').forEach((b) => {
    b.onclick = () => {
      cronogramaTab = b.dataset.cronogramaTab;
      $all('.tab-btn[data-cronograma-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $('#cronogramaCalendarioWrap').hidden = cronogramaTab !== 'calendario';
      $('#cronogramaFeedWrap').hidden = cronogramaTab !== 'feed';
      renderCronograma();
    };
  });
  $all('.tab-btn[data-feed-network]').forEach((b) => {
    b.onclick = () => {
      cronogramaFeedNetwork = b.dataset.feedNetwork;
      $all('.tab-btn[data-feed-network]').forEach((x) => x.classList.toggle('active', x === b));
      renderCronogramaFeed();
    };
  });
  $('#cronogramaPrevMonth').onclick = () => {
    cronogramaCalMonth = new Date(cronogramaCalMonth.getFullYear(), cronogramaCalMonth.getMonth() - 1, 1);
    renderCronogramaCalendar();
  };
  $('#cronogramaNextMonth').onclick = () => {
    cronogramaCalMonth = new Date(cronogramaCalMonth.getFullYear(), cronogramaCalMonth.getMonth() + 1, 1);
    renderCronogramaCalendar();
  };

  async function loadCronograma() {
    await ensureSocialMeta();
    const data = await api('/api/social-posts');
    socialPosts = data.posts;
    renderCronograma();
  }

  function renderCronograma() {
    if (cronogramaTab === 'feed') {
      renderCronogramaFeed();
    } else {
      renderCronogramaCalendar();
    }
  }

  // Abre o post direto no Agendamento — clicar num card do calendário ou
  // da prévia do feed leva pra edição sem precisar procurar na tabela.
  async function openPostFromCronograma(postId) {
    setActiveNav('navAgendamento');
    showView('agendamento');
    await loadSocialPosts();
    const post = socialPosts.find((p) => p.id === postId);
    if (post) {
      socialTab = post.brand || 'debacco';
      $all('.tab-btn[data-social-tab]').forEach((x) => x.classList.toggle('active', x.dataset.socialTab === socialTab));
      renderSocialPosts();
      openSocialPostForm(post);
    }
  }

  function renderCronogramaCalendar() {
    const year = cronogramaCalMonth.getFullYear();
    const month = cronogramaCalMonth.getMonth();
    $('#cronogramaMonthLabel').textContent = `${MONTHS_FULL[month]} ${year}`;

    const grid = $('#cronogramaCalGrid');
    grid.innerHTML = '';
    WEEKDAYS_SHORT.forEach((w) => {
      const el = document.createElement('div');
      el.className = 'cal-weekday';
      el.textContent = w;
      grid.appendChild(el);
    });

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - firstWeekday + 1;
      let cellYear = year, cellMonth = month, cellDay = dayOffset, otherMonth = false;
      if (dayOffset < 1) {
        cellMonth = month - 1; cellDay = daysInPrevMonth + dayOffset; otherMonth = true;
        if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      } else if (dayOffset > daysInMonth) {
        cellMonth = month + 1; cellDay = dayOffset - daysInMonth; otherMonth = true;
        if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      }
      const dateStr = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(cellDay).padStart(2, '0')}`;

      const cell = document.createElement('div');
      cell.className = 'cal-day' + (otherMonth ? ' other-month' : '') + (dateStr === todayStr ? ' today' : '');
      const num = document.createElement('div');
      num.className = 'cal-day-num';
      num.textContent = cellDay;
      cell.appendChild(num);

      const dayPosts = socialPosts
        .filter((p) => (p.brand || 'debacco') === cronogramaBrand && p.scheduledDate === dateStr)
        .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
      dayPosts.forEach((p) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cal-post-chip';
        chip.innerHTML = `<b>${p.scheduledTime || '--:--'} · ${SOCIAL_PLATFORM_LABEL[p.platform] || p.platform}</b>${SOCIAL_POST_TYPE_LABEL[p.postType] || ''}`;

        // Tags coloridas pelo cargo de quem está envolvido no material:
        // designer = azul, videomaker = verde, designer 3D = verde neon
        // (além das outras, quando o material também precisa de 3D).
        const involvedCargos = (p.involvedUserIds || []).map((id) => {
          const u = teamMembers.find((m) => m.id === id);
          return u ? u.cargo : '';
        });
        const tagDefs = [
          ['designer', 'tag-designer'],
          ['videomaker', 'tag-videomaker'],
          ['designer3d', 'tag-designer3d']
        ].filter(([cargo]) => involvedCargos.includes(cargo));
        if (tagDefs.length > 0) {
          const tagsWrap = document.createElement('div');
          tagsWrap.className = 'cal-post-tags';
          tagDefs.forEach(([cargo, cls]) => {
            const dot = document.createElement('span');
            dot.className = 'cal-post-tag ' + cls;
            dot.title = CARGO_LABEL[cargo] || cargo;
            tagsWrap.appendChild(dot);
          });
          chip.appendChild(tagsWrap);
        }

        chip.onclick = () => openPostFromCronograma(p.id);
        cell.appendChild(chip);
      });

      grid.appendChild(cell);
    }
  }

  function renderCronogramaFeed() {
    const list = $('#cronogramaFeedList');
    list.innerHTML = '';
    const isLinkedin = cronogramaFeedNetwork === 'linkedin';
    const posts = socialPosts
      .filter((p) => (p.brand || 'debacco') === cronogramaBrand)
      .filter((p) => (isLinkedin ? p.platform === 'linkedin' : (p.platform === 'instagram' || p.platform === 'facebook')))
      .sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
    $('#cronogramaFeedEmpty').hidden = posts.length > 0;

    posts.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'feed-preview-card' + (isLinkedin ? ' linkedin' : '');
      card.style.cursor = 'pointer';

      const file = (p.files || [])[0];
      const isVideo = !!file && /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name || file.url || '');
      const mediaHtml = file
        ? (isVideo ? `<video src="${file.url}" controls></video>` : `<img src="${file.url}" alt="">`)
        : `<div class="feed-preview-noimg">Sem criativo anexado ainda</div>`;

      const accountLabel = SOCIAL_PLATFORM_LABEL[p.platform] || p.platform;
      const initial = ((currentUser && (currentUser.name || currentUser.username)) || 'P').slice(0, 1).toUpperCase();
      const header = `
        <div class="feed-preview-header">
          <div class="feed-preview-avatar">${initial}</div>
          <div class="feed-preview-headtext">
            <span class="feed-preview-account">${p.createdByName || accountLabel}</span>
            <span class="feed-preview-meta">${fmtDate(p.scheduledDate)}${p.scheduledTime ? ' · ' + p.scheduledTime : ''} · ${SOCIAL_POST_TYPE_LABEL[p.postType] || ''}</span>
          </div>
        </div>`;
      const captionHtml = `<div class="feed-preview-caption"><b>${p.createdByName || accountLabel}</b> ${p.caption || '(sem legenda)'}</div>`;

      card.innerHTML = isLinkedin
        ? header + captionHtml + `<div class="feed-preview-media">${mediaHtml}</div>`
        : header + `<div class="feed-preview-media">${mediaHtml}</div><div class="feed-preview-actions">♡ ⤳ ✉</div>` + captionHtml;

      card.onclick = () => openPostFromCronograma(p.id);
      list.appendChild(card);
    });
  }

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
        <td>${CARGO_LABEL[u.cargo] || '—'}</td>
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
    $('#userFormCargo').value = user ? (user.cargo || '') : '';
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
      cargo: $('#userFormCargo').value,
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
      // Editou o próprio usuário (ex: o super admin mudando o próprio
      // cargo) — recarrega currentUser pra aplicar na hora, sem precisar
      // deslogar e logar de novo (ex: acesso ao Calendário do Cronograma).
      if (editingUserId === currentUser.id) {
        const me = await api('/api/auth/me');
        currentUser = me.user;
        applyCronogramaAccess();
      }
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
