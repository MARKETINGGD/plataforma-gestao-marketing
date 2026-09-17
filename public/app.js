(function () {
  let token = localStorage.getItem('token') || null;
  let currentUser = null;
  let dashboardsByKey = {};
  // Link externo por dashboard (28ª rodada) — quando a página é aberta com
  // ?dashboardPublic=<token>, entra em "modo público": sem login, mostra só
  // o hub daquele dashboard (Mídias ou Tráfego), com a barra lateral da
  // Papoi escondida (ver .public-hub-mode no style.css).
  let dashboardPublicToken = null;
  let dashboardPublicKey = null; // 'redesSociais' | 'trafegoPago'
  let budgetAccess = 'none';
  let budgetEntries = [];
  let budgetFluxosByBrand = {};
  let currentBudgetBrand = 'debacco';
  let budgetTab = 'geral';
  let editingBudgetId = null;
  let editingUserId = null;
  let pendingUserPhotoFile = null; // foto escolhida antes do usuário existir (cadastro novo)

  let teamMembers = [];
  let demandas = [];
  let demandasArchived = [];
  let showingArchived = false;
  let editingDemandaId = null;
  // Checklist "rascunho" de um card ainda não salvo (26ª rodada, pedido da
  // Raquel: "ao cadastrar um card, o check lista deve ficar liberado já
  // antes de salvar o card"). Só é usado enquanto editingDemandaId é null —
  // assim que o card é criado, os itens vão junto no POST e a partir daí o
  // checklist volta a ser mutado direto pela API, como sempre foi.
  let draftChecklist = [];
  let labels = [];
  let labelSuggestedColors = [];
  let selectedAssigneeIds = new Set();
  let selectedLabelIds = new Set();
  let selectedDemColor = null; // cor de fundo do card (opcional, 12ª rodada) — null = sem cor
  let editingLabelColor = null;
  let demandasScope = 'geral'; // 'geral' | 'pessoal'
  let draggedColId = null; // arrastar pra reordenar as colunas do quadro (17ª rodada)
  let draggedCardId = null; // arrastar pra reordenar os cards dentro de uma lista (21ª rodada)
  let demandaSoundSeenIds = null; // watcher de som pra demanda nova atribuída a mim (17ª rodada)

  let recadosForMe = [];
  let recadosAll = [];
  let chatLastId = null; // último id de mensagem já mostrado, pra buscar só as novas no polling
  let chatPollTimer = null;
  let activeViewName = null; // nome da tela atual (21ª rodada, ver showView) — usado pra saber
  // se a pessoa já está vendo o Chat da Equipe em tamanho cheio, e então não duplicar aviso
  let widgetChatLastId = null; // cursor independente do chatLastId da tela cheia — a janelinha
  // flutuante do chat continua rodando (e contando mensagens novas) mesmo em outras telas
  let widgetChatBaselineSet = false;
  let chatWidgetOpen = false;
  let chatWidgetUnread = 0;
  let chatWidgetPollTimer = null;
  let chatToastTimer = null;
  let recadoSuggestedColors = [];
  let selectedRecadoColor = null;
  let selectedRecadoTargetIds = new Set();

  // ---------- 22ª rodada: notificação flutuante (recado/demanda), histórico
  // de Demandas e lightbox da Prévia do Feed ----------
  let notifToastTimer = null;
  let feedLightboxFiles = [];
  let feedLightboxIndex = 0;

  let socialPosts = [];
  let socialPlatforms = [];
  let socialStatuses = [];
  let socialPostTypes = [];
  let socialVideoPostTypes = [];
  let socialVideoPlatforms = [];
  let editingSocialPostId = null;
  let socialTab = 'debacco'; // 'debacco' | 'ghelplus'
  let socialInvolvedIds = new Set();
  let socialCarouselBriefings = []; // array de textos, um por card do carrossel

  let cronogramaTab = 'calendario'; // 'calendario' | 'feed'
  let cronogramaFeedNetwork = 'ig_fb'; // 'ig_fb' | 'linkedin'
  let cronogramaBrand = 'debacco'; // 'debacco' | 'ghelplus'
  let cronogramaCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  let brindesTab = 'debacco'; // 'debacco' | 'ghelplus' | 'log'
  let brindesCatalog = [];
  let brindesLog = [];
  let editingBrindeId = null;
  let editingBrindeLogId = null;

  // ---------- Gerenciamento de Influencers (14ª rodada) ----------
  let influencersTab = 'debacco'; // 'debacco' | 'ghelplus'
  let influencersList = [];
  let editingInfluencerId = null;
  let currentInfluencer = null; // influencer aberto na tela de tabela
  let currentInfluencerPosts = [];
  let editingInfluencerPostId = null;
  let influencerRedes = [];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Responsividade (20ª rodada, pedido da Raquel: "Deixe responsivo para
  // qualquer tela"). As tabelas (.data-table) têm várias colunas e não
  // cabem numa tela estreita — em vez de estourar a largura da página ou
  // depender do body inteiro rolando de lado, cada tabela ganha um wrapper
  // que rola na horizontal só ali, mantendo o resto da tela no lugar.
  $all('table.data-table').forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  // ---------- Popover genérico de cor (13ª rodada) ----------
  // Reaproveitado pra cor da lista de cada pessoa em Demandas e pra cor de
  // fundo (pessoal) da tela Início — mesma paleta sugerida das etiquetas.
  let openColorPopoverEl = null;
  function closeColorPopover() {
    if (openColorPopoverEl) { openColorPopoverEl.remove(); openColorPopoverEl = null; }
  }
  document.addEventListener('click', (e) => {
    if (openColorPopoverEl && !openColorPopoverEl.contains(e.target) && !e.target.classList.contains('color-dot-btn')) {
      closeColorPopover();
    }
  });
  function openColorPopover(anchorBtn, currentColor, onSelect) {
    closeColorPopover();
    const pop = document.createElement('div');
    pop.className = 'color-popover';
    const wrap = document.createElement('div');
    wrap.className = 'color-swatches';
    const none = document.createElement('div');
    none.className = 'color-swatch color-swatch-none' + (!currentColor ? ' selected' : '');
    none.title = 'Sem cor';
    none.onclick = () => { onSelect(null); closeColorPopover(); };
    wrap.appendChild(none);
    (labelSuggestedColors.length ? labelSuggestedColors : ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563']).forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (currentColor === c ? ' selected' : '');
      sw.style.background = c;
      sw.onclick = () => { onSelect(c); closeColorPopover(); };
      wrap.appendChild(sw);
    });
    pop.appendChild(wrap);
    document.body.appendChild(pop);
    const rect = anchorBtn.getBoundingClientRect();
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 190)) + 'px';
    openColorPopoverEl = pop;
  }
  function setColorDotBtn(btn, color) {
    if (color) { btn.style.background = color; btn.classList.add('has-color'); }
    else { btn.style.background = '#fff'; btn.classList.remove('has-color'); }
  }
  // Foto de perfil (20ª rodada): "fotinho da pessoa" no bate-papo e no
  // cronograma. Quando a pessoa não tem foto cadastrada (ou já não existe
  // mais), cai pra um círculo com a inicial do nome — mesmo padrão visual
  // que já existia no cabeçalho da Prévia do Feed, só que reaproveitável em
  // qualquer lugar da tela.
  function avatarHtml(person, size, extraClass) {
    size = size || 28;
    const cls = extraClass ? ' ' + extraClass : '';
    const name = (person && (person.name || person.username)) || '';
    const initial = (name || '?').slice(0, 1).toUpperCase();
    if (person && person.photoUrl) {
      return `<img src="${person.photoUrl}" class="avatar-img${cls}" style="width:${size}px;height:${size}px;" alt="${name}" title="${name}">`;
    }
    return `<div class="avatar-fallback${cls}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;" title="${name}">${initial}</div>`;
  }

  // ---------- Histórico de Demandas (22ª rodada) ----------
  // Rótulos em PT de cada tipo de ação registrada no histórico — espelham
  // as `action` gravadas pelo backend (ver routes/demandas.js).
  const HISTORY_ACTION_LABEL = {
    create: 'criou o card',
    update: 'atualizou o card',
    archive: 'arquivou o card',
    unarchive: 'desarquivou o card',
    delete: 'excluiu o card',
    checklist_add: 'adicionou item ao checklist',
    checklist_update: 'atualizou item do checklist',
    checklist_remove: 'removeu item do checklist',
    file_upload: 'enviou um arquivo',
    file_delete: 'removeu um arquivo'
  };
  // Monta a lista de histórico num container — reaproveitado tanto pelo
  // histórico de UM card (modal da demanda) quanto pelo histórico do
  // quadro geral inteiro (que também mostra o título do card em cada
  // linha, via opts.showEntity). Texto do usuário (nome, detalhes,
  // título do card) sempre via textContent, nunca innerHTML — mesmo
  // cuidado já usado no Chat da Equipe (18ª rodada), pra ninguém injetar
  // HTML/script através de um texto que digitou em algum lugar.
  function renderHistoryList(containerId, entries, opts) {
    opts = opts || {};
    const wrap = $('#' + containerId);
    wrap.innerHTML = '';
    if (!entries || entries.length === 0) {
      wrap.innerHTML = '<div class="muted" style="font-size:12.5px;">Nenhuma alteração registrada ainda.</div>';
      return;
    }
    entries.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        ${avatarHtml({ name: e.userName, photoUrl: e.userPhoto }, 24)}
        <div class="history-row-body">
          <div class="history-row-main"></div>
          <div class="history-row-details muted" style="font-size:12px;" hidden></div>
          <div class="history-row-time"></div>
        </div>
      `;
      const label = HISTORY_ACTION_LABEL[e.action] || e.action;
      let mainLine = (e.userName || 'Alguém') + ' ' + label;
      if (opts.showEntity && e.entityLabel) mainLine += ' — ' + e.entityLabel;
      row.querySelector('.history-row-main').textContent = mainLine;
      if (e.details) {
        const d = row.querySelector('.history-row-details');
        d.textContent = e.details;
        d.hidden = false;
      }
      row.querySelector('.history-row-time').textContent = fmtDateTime(e.createdAt);
      wrap.appendChild(row);
    });
  }
  async function loadDemHistory(demandaId) {
    if (!demandaId) {
      $('#demHistoryLabel').hidden = true;
      $('#demHistory').hidden = true;
      return;
    }
    $('#demHistoryLabel').hidden = false;
    $('#demHistory').hidden = false;
    try {
      const data = await api(`/api/demandas/${demandaId}/history`);
      renderHistoryList('demHistory', data.history);
    } catch (e) { /* ignora falha pontual */ }
  }
  async function openBoardHistoryModal() {
    $('#boardHistoryModal').hidden = false;
    try {
      const data = await api('/api/demandas/history');
      $('#boardHistoryEmpty').hidden = data.history.length > 0;
      renderHistoryList('boardHistoryList', data.history, { showEntity: true });
    } catch (e) { /* ignora falha pontual */ }
  }
  $('#demandasHistoryBtn').onclick = openBoardHistoryModal;
  $('#boardHistoryClose').onclick = () => { $('#boardHistoryModal').hidden = true; };

  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const BRAND_LABEL = { ghelplus: 'GhelPlus', debacco: 'De Bacco', duranox: 'Duranox', boutiqueinox: 'Boutique Inox' };
  const STATUS_COLUMNS = [
    { key: 'a_fazer', label: 'A Fazer' },
    { key: 'andamento', label: 'Em Andamento' },
    { key: 'aprovacao', label: 'Em Aprovação' },
    { key: 'concluida', label: 'Concluída' }
  ];
  const SOCIAL_PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', newsletter: 'Newsletter' };
  const INFLUENCER_STATUS_LABEL = { a_publicar: 'A publicar', publicada: 'Publicada', cancelada: 'Cancelada' };
  // Cores da 15ª rodada: status em "farol" (amarelo/verde/vermelho) e cada
  // rede social com sua própria cor, pra dar de cara o panorama da tabela.
  const INFLUENCER_STATUS_COLOR = { a_publicar: { bg: '#F5C518', text: '#4a3b00' }, publicada: { bg: '#2F9E44', text: '#fff' }, cancelada: { bg: '#E03131', text: '#fff' } };
  const INFLUENCER_REDE_COLOR = { instagram: '#E1306C', tiktok: '#00C2E0', youtube: '#FF0000', facebook: '#1877F2', pinterest: '#BD081C' };
  function influencerStatusPillHTML(status, editable, postId) {
    const c = INFLUENCER_STATUS_COLOR[status] || { bg: '#ccc', text: '#333' };
    const style = `background:${c.bg};color:${c.text};border:none;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;cursor:${editable ? 'pointer' : 'default'};font-family:inherit;`;
    if (!editable) {
      return `<span style="${style}">${INFLUENCER_STATUS_LABEL[status] || status}</span>`;
    }
    const opts = Object.keys(INFLUENCER_STATUS_LABEL).map((k) => `<option value="${k}" ${k === status ? 'selected' : ''}>${INFLUENCER_STATUS_LABEL[k]}</option>`).join('');
    return `<select data-inf-status-select="${postId}" style="${style}">${opts}</select>`;
  }
  const SOCIAL_STATUS_LABEL = { rascunho: 'Rascunho', agendado: 'Agendado', publicado: 'Publicado' };
  const SOCIAL_POST_TYPE_LABEL = { g_news: 'G-NEWS', contatto: 'Contatto', estatico: 'Estático', carrossel: 'Carrossel', reels: 'Reels', storie: 'Storie', video_tiktok: 'Vídeo TikTok', video_youtube: 'Vídeo YouTube', pin: 'Pin' };
  // Tipo de newsletter tem nome diferente por marca — mesma coisa, nomes distintos.
  const NEWSLETTER_TYPE_BY_BRAND = { ghelplus: 'g_news', debacco: 'contatto' };

  // 21 saudações divertidas da tela Início (pedido da Raquel, 13ª rodada) —
  // sorteada uma a cada novo login (fica a mesma durante a sessão, muda de
  // novo quando a pessoa faz login de novo). {nome} vira o nome da pessoa.
  const HOME_GREETINGS = [
    'Já tomou seu cafézinho hoje?',
    'Olá, {nome}! O algoritmo sentiu sua falta.',
    'Café na mão, {nome}? Então podemos falar de estratégia.',
    'Respira, {nome}… é só mais uma alteraçãozinha.',
    'Bem-vindo, {nome}! Hoje o briefing vem completo. Confia.',
    '{nome}, preparado para transformar café em campanha?',
    'Entre, fique à vontade. Os KPIs estão te esperando, {nome}.',
    'Hoje vai dar tudo certo, {nome}. Até o Meta colaborar.',
    'Bom dia, {nome}! Que seus criativos performem e seus clientes aprovem de primeira.',
    'Você chegou, {nome}! Agora oficialmente podemos culpar o algoritmo.',
    'Atenção, {nome}: grandes ideias podem acontecer por aqui.',
    'Mais um dia fingindo que "só um ajuste" leva 5 minutos, hein, {nome}?',
    'Olá, {nome}! Bem-vindo ao lugar onde tudo vira conteúdo.',
    'Seu café está forte, {nome}? Porque o briefing está fraco.',
    'Hoje tem estratégia, criatividade e provavelmente uma alteração de última hora. Boa sorte, {nome}.',
    'Que hoje o alcance seja alto e o custo por resultado seja baixo. Ouvi um amém, {nome}?',
    'Você não está procrastinando, {nome}. Está buscando referências.',
    'Calma, marketer. Nem todo número vermelho é uma tragédia.',
    'Seu painel está pronto, {nome}. Seu emocional, não garantimos.',
    'Bem-vindo, {nome}! Aqui a gente transforma "faz algo legal" em estratégia.',
    'Olá, {nome}, percebeu que faltou um "tchan" naquele post?'
  ];
  function pickHomeGreeting(nome) {
    let idx = sessionStorage.getItem('homeGreetingIdx');
    if (idx === null || isNaN(Number(idx))) {
      idx = Math.floor(Math.random() * HOME_GREETINGS.length);
      sessionStorage.setItem('homeGreetingIdx', String(idx));
    } else {
      idx = Number(idx);
    }
    return HOME_GREETINGS[idx].replace(/\{nome\}/g, nome);
  }
  const NORMAL_POST_TYPES = ['estatico', 'carrossel', 'reels', 'storie', 'video_tiktok', 'video_youtube', 'pin'];
  const CARGO_LABEL = { gerente: 'Gerente', analista: 'Analista', auxiliar: 'Auxiliar', coordenador: 'Coordenador(a)', designer: 'Designer', designer3d: 'Designer 3D', videomaker: 'Videomaker' };
  const fmtMoney = (n) => n === null || n === undefined || n === ''
    ? '—'
    : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  // Usado pra mostrar quando uma sugestão de alteração foi pedida
  // (timestamp completo, não só a data em AAAA-MM-DD).
  const fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
    ['loading', 'setup', 'login', 'app', 'influencer-public'].forEach((s) => {
      $('#screen-' + s).hidden = s !== name;
    });
  }

  function setActiveNav(id) {
    $all('.navlink').forEach((b) => b.classList.toggle('active', b.id === id));
    // O "Budget" da barra lateral virou 1 botão só com submenu por marca
    // (25ª rodada) — ao ativar um item do submenu, o botão-pai também fica
    // marcado como ativo (senão pareceria que nada da barra está selecionado).
    if (id === 'navBudgetDebacco' || id === 'navBudgetGhelplus') {
      $('#navBudgetParent').classList.add('active');
      $('#navBudgetSubmenu').hidden = false;
    }
  }

  function showView(name) {
    activeViewName = name;
    $all('.view').forEach((v) => (v.hidden = true));
    $('#view-' + name).hidden = false;
    // Cor pessoal da tela Início cobre toda a área de conteúdo (14ª rodada)
    // — só enquanto a Início está ativa; nas outras telas o conteúdo volta
    // ao normal (a aba lateral nunca muda de cor).
    if (name === 'home') {
      applyHomeColor();
    } else {
      $('.content').style.background = '';
    }
    // O polling do Chat da Equipe só roda enquanto a tela está aberta
    // (18ª rodada) — sair da tela para em vez de continuar consultando o
    // servidor à toa em segundo plano.
    if (name !== 'chat') stopChatPolling();
    // Bolha/janelinha flutuante do Chat da Equipe (21ª rodada) — some
    // enquanto a pessoa já está na tela cheia do chat (ali ela já vê tudo,
    // a bolha ficaria redundante); nas outras telas, fica disponível.
    if (currentUser) {
      if (name === 'chat') {
        $('#chatWidgetToggle').hidden = true;
        if (chatWidgetOpen) closeChatWidget();
      } else {
        $('#chatWidgetToggle').hidden = false;
      }
    }
  }

  // ---------- boot ----------
  async function loadInfluencerPublicPage(pubToken) {
    try {
      const data = await fetch('/api/influencers/public/' + encodeURIComponent(pubToken)).then((r) => r.json().then((body) => ({ ok: r.ok, body })));
      if (!data.ok) throw new Error(data.body.error || 'Link inválido.');
      const { influencer, posts } = data.body;
      $('#pubInfName').textContent = influencer.name + ' — ' + (BRAND_LABEL[influencer.brand] || influencer.brand);
      const body = $('#pubInfPostsBody');
      body.innerHTML = '';
      $('#pubInfEmpty').hidden = posts.length > 0;
      posts.forEach((p) => {
        const tr = document.createElement('tr');
        if (p.rede && INFLUENCER_REDE_COLOR[p.rede]) {
          tr.style.background = `color-mix(in srgb, ${INFLUENCER_REDE_COLOR[p.rede]} 12%, white)`;
        }
        tr.innerHTML = `
          <td>${p.formato || '—'}</td>
          <td>${SOCIAL_PLATFORM_LABEL[p.rede] || p.rede || '—'}</td>
          <td>${influencerStatusPillHTML(p.status, false)}</td>
          <td>${p.dataPostagem ? fmtDate(p.dataPostagem) : '—'}</td>
          <td>${p.arquivo ? `<a href="${p.arquivo.url}" target="_blank" rel="noopener">${p.arquivo.name}</a>` : '—'}</td>
          <td>${p.observacoes || '—'}</td>
          <td>${p.notas || '—'}</td>
        `;
        body.appendChild(tr);
      });
      showScreen('influencer-public');
    } catch (e) {
      $('#pubInfError').hidden = false;
      showScreen('influencer-public');
    }
  }

  // Link externo por dashboard (28ª rodada) — mesmo espírito do link do
  // influencer, mas pro hub inteiro de Mídias ou Tráfego. Resolve o token
  // (GET /api/dashboards/public/:token, sem login), reaproveita a MESMA tela
  // autenticada (#screen-app) — só esconde a barra lateral da Papoi (classe
  // public-hub-mode) e mostra um topo simples no lugar dela — e abre direto
  // o hub daquele dashboard, já em "modo visitante" (sem os controles de
  // Link externo, que só fazem sentido pra quem está logado).
  async function startDashboardPublicMode(pubToken) {
    dashboardPublicToken = pubToken;
    try {
      const res = await fetch('/api/dashboards/public/' + encodeURIComponent(pubToken));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Link inválido ou desativado.');
      dashboardPublicKey = body.key;
      dashboardsByKey[body.key] = body;
      $('.app-shell').classList.add('public-hub-mode');
      $('#publicHubTopbar').hidden = false;
      $('#publicHubTopbarLabel').textContent = body.label;
      showScreen('app');
      if (body.key === 'redesSociais') {
        await openMidiasHub();
      } else if (body.key === 'trafegoPago') {
        openTrafegoHub();
      } else {
        throw new Error('Este link externo ainda não é compatível com esta tela.');
      }
    } catch (e) {
      $('#screen-loading p').textContent = e.message || 'Link inválido ou desativado.';
    }
  }

  async function boot() {
    // Link externo por influencer (14ª rodada) — não exige login, funciona
    // pra quem não está dentro da plataforma. Checa antes de qualquer coisa.
    const pubToken = new URLSearchParams(window.location.search).get('influencerPublic');
    if (pubToken) {
      showScreen('loading');
      await loadInfluencerPublicPage(pubToken);
      return;
    }
    // Link externo por dashboard — Mídias/Tráfego (28ª rodada) — mesma ideia,
    // pra quem acompanha de fora sem ter conta na Plataforma.
    const dashPubToken = new URLSearchParams(window.location.search).get('dashboardPublic');
    if (dashPubToken) {
      showScreen('loading');
      await startDashboardPublicMode(dashPubToken);
      return;
    }
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
    // Carrega a paleta de cores sugeridas cedo (não só quando visita
    // Demandas), pra já estar pronta pro seletor de cor da tela Início.
    try {
      const labelsData = await api('/api/labels');
      labelSuggestedColors = labelsData.suggestedColors || labelSuggestedColors;
    } catch (e) { /* ignora */ }
    applyCronogramaAccess();
    await loadHome();
    showView('home');
    setActiveNav('navHome');
    startNotificationSoundWatcher();
    // Janelinha flutuante do Chat da Equipe (21ª rodada) — carrega o
    // histórico e começa a checar mensagens novas assim que loga, pra
    // avisar (som + aviso no canto) mesmo enquanto a pessoa está em
    // qualquer outra tela, não só na tela "Chat da Equipe".
    initChatWidget();
    startChatWidgetPolling();
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

  // Ainda nao existe fluxo de redefinicao de senha por e-mail (precisaria
  // de um servico de envio configurado) -- por enquanto so orienta a
  // pessoa a pedir pra um admin trocar a senha dela pela tela Usuarios.
  $('#loginForgotBtn').onclick = () => {
    $('#loginError').textContent = 'Peça para um administrador da plataforma redefinir sua senha em Usuários.';
    $('#loginError').hidden = false;
  };

  $('#logoutBtn').onclick = () => {
    token = null; currentUser = null;
    localStorage.removeItem('token');
    sessionStorage.removeItem('homeGreetingIdx'); // próximo login sorteia outra frase
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
  // "Budget" (25ª rodada): 1 botão só na barra lateral — ao clicar, só
  // abre/fecha o submenu com as marcas (não navega pra lugar nenhum sozinho).
  $('#navBudgetParent').onclick = () => {
    const sub = $('#navBudgetSubmenu');
    sub.hidden = !sub.hidden;
  };
  $all('.navlink').forEach((b) => {
    if (b.id === 'navBudgetParent') return;
    b.onclick = () => {
      setActiveNav(b.id);
      // Gerenciamento de Mídias (26ª rodada): não abre mais o iframe cheio
      // do painel de Redes Sociais — abre a central nativa da Papoi
      // (view-midias-hub) primeiro; ver openMidiasHub().
      if (b.dataset.view === 'midias-hub') {
        openMidiasHub();
      } else if (b.dataset.view === 'trafego-hub') {
        openTrafegoHub();
      } else if (b.dataset.dash) {
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
        if (b.dataset.view === 'influencers') loadInfluencers();
        if (b.dataset.view === 'chat') loadChat();
      }
    };
  });

  // ---------- Início ----------
  // Cor de fundo da tela Início (13ª rodada) — preferência pessoal: só a
  // própria pessoa vê a cor que ela escolheu, tom bem suave (color-mix)
  // pra não brigar com o conteúdo, mas visível como pedido.
  function applyHomeColor() {
    // Pinta a área de conteúdo inteira (.content), não só a caixinha da
    // Início — vai até o fim da página, só a aba lateral (sidebar) fica
    // de fora, como pedido na 14ª rodada.
    const content = $('.content');
    const color = currentUser.homeColor || null;
    content.style.background = color ? `color-mix(in srgb, ${color} 10%, white)` : '';
    setColorDotBtn($('#homeColorBtn'), color);
  }
  $('#homeColorBtn').onclick = (e) => {
    e.stopPropagation();
    openColorPopover($('#homeColorBtn'), currentUser.homeColor || null, async (color) => {
      await api('/api/auth/me/home-color', { method: 'PUT', body: JSON.stringify({ color }) });
      currentUser.homeColor = color;
      applyHomeColor();
    });
  };

  // Resumo da Início em lista + barrinha, no lugar dos quadrados de número
  // de antes (18ª rodada: "esta feio visualmente tudo separado em
  // quadrados, deixe com lista e grafico, de uma forma mais visual e
  // delicada"). `rows`: [{label, value, color, display?}] — a barra de
  // cada linha é proporcional ao maior valor do grupo (não é um total de
  // 100%, já que "Atrasadas" é um recorte que pode se sobrepor às outras
  // — então uma barra de comparação simples é mais honesta que um donut).
  function renderStatBars(containerId, rows) {
    const wrap = $('#' + containerId);
    const max = Math.max(1, ...rows.map((r) => r.value));
    wrap.innerHTML = rows.map((r) => `
      <div class="stat-bar-row">
        <div class="stat-bar-row-top">
          <span class="stat-bar-label"><span class="stat-bar-dot" style="background:${r.color}"></span>${r.label}</span>
          <span class="stat-bar-value">${r.display !== undefined ? r.display : r.value}</span>
        </div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((r.value / max) * 100)}%;background:${r.color}"></div></div>
      </div>
    `).join('');
  }

  async function loadHome() {
    const data = await api('/api/dashboards');
    budgetAccess = data.budgetAccess;
    dashboardsByKey = {};
    data.dashboards.forEach((d) => { dashboardsByKey[d.key] = d; });
    $('#homeGreeting').textContent = pickHomeGreeting(currentUser.name || currentUser.username);
    applyHomeColor();

    await loadRecados();

    try {
      const sum = await api('/api/demandas/summary');
      renderStatBars('demandasStatList', [
        { label: 'Atrasadas', value: sum.summary.atrasada, color: 'var(--danger)' },
        { label: 'Em andamento', value: sum.summary.andamento, color: 'var(--primary)' },
        { label: 'Em aprovação', value: sum.summary.aprovacao, color: '#f2a900' },
        { label: 'Concluídas', value: sum.summary.concluida, color: '#2ea043' }
      ]);
    } catch (e) { /* usuário pode não ter permissão futura — hoje é liberado a todos */ }

    if (budgetAccess !== 'none') {
      // 24ª rodada: resumo da Início separado por marca (antes somava
      // De Bacco + GhelPlus num número só, e não dava pra saber de qual
      // marca era o valor mostrado).
      const year = new Date().getFullYear();
      const budgetHomeBrands = [
        { key: 'debacco', statId: 'budgetStatListDebacco', diffId: 'budgetDiffLineDebacco' },
        { key: 'ghelplus', statId: 'budgetStatListGhelplus', diffId: 'budgetDiffLineGhelplus' }
      ];
      for (const b of budgetHomeBrands) {
        try {
          const data = await api('/api/budget?year=' + year + '&brand=' + b.key);
          const totalPlan = data.entries.reduce((s, e) => s + (Number(e.planejado) || 0), 0);
          const totalReal = data.entries.reduce((s, e) => s + (Number(e.realizado) || 0), 0);
          renderStatBars(b.statId, [
            { label: 'Planejado', value: totalPlan, display: fmtMoney(totalPlan), color: 'var(--muted)' },
            { label: 'Realizado', value: totalReal, display: fmtMoney(totalReal), color: 'var(--primary)' }
          ]);
          const diff = totalReal - totalPlan;
          const diffLine = $('#' + b.diffId);
          diffLine.textContent = `Diferença: ${fmtMoney(diff)}`;
          diffLine.className = 'budget-diff ' + (diff > 0 ? 'budget-diff-over' : 'budget-diff-under');
        } catch (e) { /* sem acesso */ }
      }
    }

    // Brindes com estoque baixo (20ª rodada) — no lugar do resumo de
    // Tráfego Pago/Mídias, que a Raquel pediu pra tirar da tela Início.
    try {
      const low = await api('/api/brindes/low-stock');
      const wrap = $('#lowStockList');
      wrap.innerHTML = '';
      const items = low.items.slice(0, 6);
      $('#lowStockEmpty').hidden = items.length > 0;
      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'lowstock-row';
        row.innerHTML = `<span class="lowstock-name">${it.item}</span><span class="lowstock-qty">${it.estoqueTotal} un. (${BRAND_LABEL[it.brand] || it.brand})</span>`;
        wrap.appendChild(row);
      });
    } catch (e) { /* ignora falha pontual */ }
  }

  // ---------- Som de notificação: recado novo ou demanda nova (16ª/17ª rodada) ----------
  // Pedido original da Raquel (16ª rodada): toda vez que um recado novo é
  // adicionado pra ela, tocar um sinal sonoro "papoi, com a voz dos
  // Minions". Não dá pra gerar um áudio imitando a voz dos Minions (é voz
  // de personagem protegida por direitos autorais da Illumination/
  // Universal) — a Raquel mandou o arquivo de áudio dela (17ª rodada), que
  // já está em `public/sounds/recado.mp3`. Na 17ª rodada ela pediu pra esse
  // mesmo aviso sonoro tocar também quando chega uma demanda nova atribuída
  // a ela no Acompanhamento de Demandas, não só recados.
  let recadoSoundSeenIds = null;
  let notificationSoundTimer = null;
  const recadoAudio = new Audio('/sounds/recado.mp3');
  function playRecadoSound() {
    try {
      recadoAudio.currentTime = 0;
      recadoAudio.play().catch(() => { /* autoplay bloqueado ou arquivo ainda não enviado */ });
    } catch (e) { /* ignora */ }
  }
  async function checkNewRecados() {
    try {
      const data = await api('/api/recados/for-me');
      const ids = new Set(data.recados.map((r) => r.id));
      if (recadoSoundSeenIds === null) {
        // Primeira checagem da sessão: só define a base, sem tocar som —
        // senão tocaria pra recados que já estavam esperando de antes do
        // login, e a ideia é avisar sobre o que chega NOVO durante o uso.
        recadoSoundSeenIds = ids;
        return;
      }
      const novos = data.recados.filter((r) => !recadoSoundSeenIds.has(r.id));
      if (novos.length > 0) {
        playRecadoSound();
        // Notificação flutuante (22ª rodada, pedido da Raquel: "quando
        // tiver notificação de recado ou demandas novas, deve subir um
        // card pequeno na tela, do lado direito... pra ter a opção de
        // clicar e ir ver ela") — mostra o mais recente dos que chegaram
        // nesse ciclo, por data de criação (não pela ordem em que a API
        // devolveu a lista).
        const r = novos.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))[novos.length - 1];
        showNotifToast({
          title: '📨 Novo recado',
          text: r.text,
          person: { name: r.createdByName, photoUrl: r.createdByPhoto },
          onClick: () => { $('#navHome').click(); }
        });
      }
      recadoSoundSeenIds = ids;
    } catch (e) { /* ignora falha de rede pontual */ }
  }
  // Demanda nova atribuída a mim (17ª rodada) — olha tanto o quadro geral
  // quanto a área pessoal, mesma lógica de "primeira checagem só define a
  // base" usada nos recados, pra não tocar som pra demanda que já existia
  // antes do login.
  async function checkNewDemandas() {
    try {
      const [geral, pessoal] = await Promise.all([
        api('/api/demandas'),
        api('/api/demandas?scope=pessoal')
      ]);
      const minhasGeral = geral.demandas.filter((d) => (d.assigneeIds || []).includes(currentUser.id));
      // Guarda também o escopo de cada uma (22ª rodada) — precisa saber se
      // é do Quadro Geral ou da Área Pessoal pra abrir na aba certa quando
      // a pessoa clicar no aviso.
      const combined = [...minhasGeral.map((d) => ({ d, scope: 'geral' })), ...pessoal.demandas.map((d) => ({ d, scope: 'pessoal' }))];
      const ids = new Set(combined.map((x) => x.d.id));
      if (demandaSoundSeenIds === null) {
        demandaSoundSeenIds = ids;
        return;
      }
      const novos = combined.filter((x) => !demandaSoundSeenIds.has(x.d.id));
      if (novos.length > 0) {
        playRecadoSound();
        // Mostra a mais recente por data de criação (não pela ordem
        // geral-depois-pessoal em que os dois vieram concatenados) —
        // senão, quando duas demandas novas chegam no mesmo ciclo de
        // checagem, sempre mostraria a pessoal (que vem por último no
        // array), mesmo que a geral tenha sido criada depois.
        const { d, scope } = novos.slice().sort((a, b) => (a.d.createdAt || '').localeCompare(b.d.createdAt || ''))[novos.length - 1];
        showNotifToast({
          title: '✅ Nova demanda',
          text: d.title,
          person: { name: d.createdByName, photoUrl: d.createdByPhoto },
          onClick: () => { goToDemandaFromNotif(d, scope); }
        });
      }
      demandaSoundSeenIds = ids;
    } catch (e) { /* ignora falha de rede pontual */ }
  }

  // Notificação flutuante genérica pra recado/demanda nova (22ª rodada) —
  // mesmo espírito visual do aviso do Chat da Equipe (21ª rodada), mas num
  // componente próprio (#notifToast), já que são avisos de origens
  // diferentes e podem aparecer em momentos distintos.
  function hideNotifToast() {
    $('#notifToast').hidden = true;
    if (notifToastTimer) { clearTimeout(notifToastTimer); notifToastTimer = null; }
  }
  function showNotifToast({ title, text, person, onClick }) {
    const toast = $('#notifToast');
    toast.innerHTML = `
      ${avatarHtml(person, 32)}
      <div class="chat-widget-toast-body">
        <div class="chat-widget-toast-name"></div>
        <div class="chat-widget-toast-text"></div>
      </div>
      <button type="button" class="chat-widget-toast-close" title="Fechar aviso">✕</button>
    `;
    toast.querySelector('.chat-widget-toast-name').textContent = title;
    toast.querySelector('.chat-widget-toast-text').textContent = text || '';
    toast.querySelector('.chat-widget-toast-close').onclick = (e) => { e.stopPropagation(); hideNotifToast(); };
    toast.onclick = () => { hideNotifToast(); if (onClick) onClick(); };
    toast.hidden = false;
    if (notifToastTimer) clearTimeout(notifToastTimer);
    notifToastTimer = setTimeout(hideNotifToast, 8000);
  }

  // Vai direto pro card da demanda que gerou o aviso (22ª rodada) — troca
  // pra aba certa (Quadro Geral/Área Pessoal), carrega e abre o modal.
  async function goToDemandaFromNotif(d, scope) {
    demandasScope = scope;
    $all('.tab-btn[data-demandas-scope]').forEach((x) => x.classList.toggle('active', x.dataset.demandasScope === scope));
    $('#demandasScopeHint').textContent = scope === 'pessoal'
      ? 'Só você e quem você marcar enxergam essas demandas.'
      : 'Visível para toda a equipe.';
    showingArchived = false;
    $('#archivedWrap').hidden = true;
    $('#kanbanBoard').hidden = false;
    $('#demandasToggleArchived').textContent = 'Ver arquivadas';
    setActiveNav('navDemandas');
    showView('demandas');
    await loadDemandas();
    const fresh = demandas.find((x) => x.id === d.id);
    if (fresh) openDemandaModal(fresh);
  }
  function startNotificationSoundWatcher() {
    checkNewRecados();
    checkNewDemandas();
    if (notificationSoundTimer) clearInterval(notificationSoundTimer);
    notificationSoundTimer = setInterval(() => {
      checkNewRecados();
      checkNewDemandas();
    }, 20000);
  }

  // ---------- Chat da Equipe (18ª rodada) ----------
  // Mural único de conversa (não são DMs) — qualquer pessoa logada vê as
  // mesmas mensagens. Sem WebSocket: só consulta em intervalos curtos
  // (polling) enquanto a tela está aberta (ver showView/stopChatPolling).
  function renderChatMessage(m) {
    const row = document.createElement('div');
    const mine = m.createdBy === currentUser.id;
    row.className = 'chat-msg-row' + (mine ? ' mine' : '');
    const time = new Date(m.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const avatarPerson = mine ? currentUser : { name: m.createdByName, photoUrl: m.createdByPhotoUrl };
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg';
    bubble.innerHTML = `<div class="chat-msg-meta"><b>${mine ? 'Você' : m.createdByName}</b><span>${time}</span></div><div class="chat-msg-text"></div>`;
    // texto via textContent (não innerHTML), pra mensagem escrita por
    // qualquer pessoa da equipe nunca virar HTML/script na tela de outra.
    bubble.querySelector('.chat-msg-text').textContent = m.text;
    row.innerHTML = avatarHtml(avatarPerson, 28);
    row.appendChild(bubble);
    return row;
  }

  function chatIsScrolledToBottom(wrap) {
    return wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40;
  }

  async function pollChat() {
    try {
      const q = chatLastId ? ('?afterId=' + encodeURIComponent(chatLastId)) : '';
      const data = await api('/api/chat/messages' + q);
      if (data.messages.length === 0) return;
      const wrap = $('#chatMessages');
      const empty = wrap.querySelector('.chat-empty');
      if (empty) empty.remove();
      const wasAtBottom = chatIsScrolledToBottom(wrap);
      data.messages.forEach((m) => wrap.appendChild(renderChatMessage(m)));
      chatLastId = data.messages[data.messages.length - 1].id;
      if (wasAtBottom) wrap.scrollTop = wrap.scrollHeight;
    } catch (e) { /* ignora falha de rede pontual */ }
  }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(pollChat, 4000);
  }
  function stopChatPolling() {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
  }

  async function loadChat() {
    const wrap = $('#chatMessages');
    try {
      const data = await api('/api/chat/messages');
      wrap.innerHTML = '';
      if (data.messages.length === 0) {
        wrap.innerHTML = '<div class="chat-empty">Nenhuma mensagem ainda. Comece a conversa!</div>';
        chatLastId = null;
      } else {
        data.messages.forEach((m) => wrap.appendChild(renderChatMessage(m)));
        chatLastId = data.messages[data.messages.length - 1].id;
        wrap.scrollTop = wrap.scrollHeight;
      }
    } catch (e) { /* ignora */ }
    startChatPolling();
  }

  async function sendChatMessage() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    try {
      const data = await api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });
      const wrap = $('#chatMessages');
      const empty = wrap.querySelector('.chat-empty');
      if (empty) empty.remove();
      wrap.appendChild(renderChatMessage(data.message));
      chatLastId = data.message.id;
      wrap.scrollTop = wrap.scrollHeight;
    } catch (e) {
      input.value = text;
      alert(e.message || 'Não foi possível enviar a mensagem.');
    }
  }
  $('#chatSendBtn').onclick = sendChatMessage;
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // ---------- Chat da Equipe: janelinha flutuante + aviso sonoro (21ª rodada) ----------
  // Pedido da Raquel: "o chat deve aparecer quando estiverem vindo
  // mensagens, como uma janelinha de notificação a ser aberta no canto
  // direito a tela. E deve fazer esse som em anexo." Reaproveita o
  // renderChatMessage já usado na tela cheia (mesmo desenho de balão) e o
  // avatarHtml já usado em outros lugares — só o cursor de polling
  // (widgetChatLastId) e o container de destino são diferentes, pra essa
  // janelinha funcionar em paralelo com a tela cheia sem se atrapalharem.
  const chatAudio = new Audio('/sounds/chat.mp3');
  function playChatSound() {
    try {
      chatAudio.currentTime = 0;
      chatAudio.play().catch(() => { /* autoplay bloqueado até a pessoa interagir com a página */ });
    } catch (e) { /* ignora */ }
  }

  async function initChatWidget() {
    const wrap = $('#chatWidgetMessages');
    try {
      const data = await api('/api/chat/messages');
      wrap.innerHTML = '';
      if (data.messages.length === 0) {
        wrap.innerHTML = '<div class="chat-empty">Nenhuma mensagem ainda.</div>';
        widgetChatLastId = null;
      } else {
        data.messages.forEach((m) => wrap.appendChild(renderChatMessage(m)));
        widgetChatLastId = data.messages[data.messages.length - 1].id;
        wrap.scrollTop = wrap.scrollHeight;
      }
    } catch (e) { /* ignora */ }
    widgetChatBaselineSet = true;
  }

  function updateChatWidgetBadge() {
    const badge = $('#chatWidgetBadge');
    if (chatWidgetUnread > 0) {
      badge.textContent = chatWidgetUnread > 9 ? '9+' : String(chatWidgetUnread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function hideChatToast() {
    $('#chatWidgetToast').hidden = true;
    if (chatToastTimer) { clearTimeout(chatToastTimer); chatToastTimer = null; }
  }

  function showChatToast(m) {
    const toast = $('#chatWidgetToast');
    const person = { name: m.createdByName, photoUrl: m.createdByPhotoUrl };
    toast.innerHTML = `
      ${avatarHtml(person, 32)}
      <div class="chat-widget-toast-body">
        <div class="chat-widget-toast-name"></div>
        <div class="chat-widget-toast-text"></div>
      </div>
      <button type="button" class="chat-widget-toast-close" title="Fechar aviso">✕</button>
    `;
    // Texto via textContent (não innerHTML), mesma cautela já usada nos
    // balões do chat — mensagem de qualquer pessoa da equipe não pode virar
    // HTML/script na tela de outra.
    toast.querySelector('.chat-widget-toast-name').textContent = m.createdByName;
    toast.querySelector('.chat-widget-toast-text').textContent = m.text;
    toast.querySelector('.chat-widget-toast-close').onclick = (e) => { e.stopPropagation(); hideChatToast(); };
    toast.onclick = () => { hideChatToast(); openChatWidget(); };
    toast.hidden = false;
    if (chatToastTimer) clearTimeout(chatToastTimer);
    chatToastTimer = setTimeout(hideChatToast, 7000);
  }

  function openChatWidget() {
    chatWidgetOpen = true;
    $('#chatWidget').hidden = false;
    chatWidgetUnread = 0;
    updateChatWidgetBadge();
    hideChatToast();
    const wrap = $('#chatWidgetMessages');
    wrap.scrollTop = wrap.scrollHeight;
    $('#chatWidgetInput').focus();
  }
  function closeChatWidget() {
    chatWidgetOpen = false;
    $('#chatWidget').hidden = true;
  }
  $('#chatWidgetToggle').onclick = () => { chatWidgetOpen ? closeChatWidget() : openChatWidget(); };
  $('#chatWidgetCloseBtn').onclick = closeChatWidget;

  async function pollChatWidget() {
    if (!widgetChatBaselineSet) return;
    // Enquanto a pessoa já está na tela cheia do Chat da Equipe, o polling
    // de lá (pollChat) já cobre tudo ao vivo — evita consultar duas vezes
    // à toa. Quando ela sair da tela, o próximo ciclo já busca tudo que
    // ficou pra trás de uma vez.
    if (activeViewName === 'chat') return;
    try {
      const q = widgetChatLastId ? ('?afterId=' + encodeURIComponent(widgetChatLastId)) : '';
      const data = await api('/api/chat/messages' + q);
      if (data.messages.length === 0) return;
      const wrap = $('#chatWidgetMessages');
      const empty = wrap.querySelector('.chat-empty');
      if (empty) empty.remove();
      const wasAtBottom = chatIsScrolledToBottom(wrap);
      data.messages.forEach((m) => wrap.appendChild(renderChatMessage(m)));
      widgetChatLastId = data.messages[data.messages.length - 1].id;
      if (wasAtBottom) wrap.scrollTop = wrap.scrollHeight;

      // Só avisa (som + aviso no canto) por mensagem de outra pessoa — a
      // própria mensagem enviada não precisa virar notificação pra quem
      // mandou.
      const fromOthers = data.messages.filter((m) => m.createdBy !== currentUser.id);
      if (fromOthers.length > 0) {
        playChatSound();
        if (!chatWidgetOpen) {
          chatWidgetUnread += fromOthers.length;
          updateChatWidgetBadge();
          showChatToast(fromOthers[fromOthers.length - 1]);
        }
      }
    } catch (e) { /* ignora falha de rede pontual */ }
  }

  function startChatWidgetPolling() {
    if (chatWidgetPollTimer) clearInterval(chatWidgetPollTimer);
    chatWidgetPollTimer = setInterval(pollChatWidget, 5000);
  }

  async function sendChatWidgetMessage() {
    const input = $('#chatWidgetInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    try {
      const data = await api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });
      const wrap = $('#chatWidgetMessages');
      const empty = wrap.querySelector('.chat-empty');
      if (empty) empty.remove();
      wrap.appendChild(renderChatMessage(data.message));
      widgetChatLastId = data.message.id;
      wrap.scrollTop = wrap.scrollHeight;
    } catch (e) {
      input.value = text;
      alert(e.message || 'Não foi possível enviar a mensagem.');
    }
  }
  $('#chatWidgetSendBtn').onclick = sendChatWidgetMessage;
  $('#chatWidgetInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatWidgetMessage();
    }
  });

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
      // Fotinho de quem mandou (22ª rodada, pedido da Raquel: "em recados,
      // deve aparecer a fotinho de quem mandou o recado").
      card.innerHTML = `
        <div class="recado-card-row">
          ${avatarHtml({ name: r.createdByName, photoUrl: r.createdByPhoto }, 28)}
          <div class="recado-card-text">${r.text}<span class="recado-card-meta">de ${r.createdByName}</span></div>
        </div>
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
        <td><div style="display:flex;align-items:center;gap:6px;">${avatarHtml({ name: r.createdByName, photoUrl: r.createdByPhoto }, 22)}${r.createdByName}</div></td>
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
  $('#homeGoBrindes').onclick = () => { $('#navBrindes').click(); };
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
  // Carrega dashboardsByKey[key] tanto no modo normal (logado, via
  // GET /api/dashboards) quanto no modo público do link externo (28ª
  // rodada, via GET /api/dashboards/public/:token, sem login).
  async function ensureDashboardMeta(key) {
    if (dashboardsByKey[key]) return dashboardsByKey[key];
    if (dashboardPublicToken) {
      const res = await fetch('/api/dashboards/public/' + encodeURIComponent(dashboardPublicToken));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Link inválido ou desativado.');
      dashboardsByKey[body.key] = body;
    } else {
      const data = await api('/api/dashboards');
      data.dashboards.forEach((d) => { dashboardsByKey[d.key] = d; });
    }
    return dashboardsByKey[key];
  }

  // Gera a URL de login único pro dashboard de destino — no modo público usa
  // o launch SEM login do link externo (28ª rodada), que entra como
  // "Visitante" (role 'none', só leitura).
  async function dashboardLaunch(key) {
    if (dashboardPublicToken) {
      const res = await fetch('/api/dashboards/public/' + encodeURIComponent(dashboardPublicToken) + '/launch');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Link inválido ou desativado.');
      return body;
    }
    return api('/api/dashboards/launch/' + key);
  }

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

  // ---------- Gerenciamento de Mídias (26ª rodada) ----------
  // Em vez de abrir o painel de Redes Sociais inteiro (com a barra lateral
  // dele, duplicando a navegação da Papoi), esta tela é uma "central"
  // nativa: uma Visão Geral + a lista de redes agrupadas, igual a Raquel
  // pediu ("apareça uma lista com todas as redes e um visão geral"). Ao
  // escolher uma rede, abre um iframe só com o CONTEÚDO daquela rede (a
  // barra lateral do outro painel fica escondida — ver .embedded-in-
  // platform no style.css dele), com um botão pra alternar entre o painel
  // da rede e o histórico de alterações daquela rede especificamente.
  //
  // O painel de Redes Sociais continua sendo dono de 100% dos dados e da
  // lógica (gráficos, formulários, importação/exportação) — nada disso foi
  // recriado aqui. A lista de marcas/redes vem ao vivo do próprio painel
  // (GET /api/public/channels, sem login), então se a Raquel adicionar uma
  // rede nova lá (editando CHANNELS em config.js, como o README dele já
  // explica), ela aparece aqui sozinha, sem precisar mexer na Papoi.
  let midiasMeta = null; // { brands: [...], channels: [...] } — cacheado após o 1º carregamento
  let midiasBrand = 'ghelplus';
  let midiasChannelId = null; // null = Visão Geral
  let midiasHistoryMode = false;

  function midiasChannelsForBrand(brand) {
    if (!midiasMeta) return [];
    return midiasMeta.channels.filter((c) => !(c.excludeBrands || []).includes(brand));
  }

  async function loadMidiasMeta() {
    if (midiasMeta) return midiasMeta;
    await ensureDashboardMeta('redesSociais');
    const baseUrl = (dashboardsByKey.redesSociais || {}).url;
    if (!baseUrl) throw new Error('URL do Gerenciamento de Mídias ainda não foi configurada.');
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/api/public/channels');
    if (!res.ok) throw new Error('Não foi possível carregar a lista de redes.');
    midiasMeta = await res.json();
    return midiasMeta;
  }

  async function openMidiasHub() {
    showView('midias-hub');
    $('#midiasHubHint').textContent = 'Carregando…';
    $('#midiasHubOverviewCard').innerHTML = '';
    $('#midiasHubGroups').innerHTML = '';
    // O botão/painel de "Link externo" só faz sentido pra quem está logado
    // gerenciando o link — quem já entrou POR um link externo não deve ver
    // esses controles (28ª rodada).
    $('#midiasHubPublicLinkBtn').hidden = !!dashboardPublicToken;
    if (dashboardPublicToken) $('#midiasPublicLinkPanel').hidden = true;
    try {
      await loadMidiasMeta();
      $('#midiasHubHint').textContent = 'Escolha uma rede pra ver o painel completo, ou abra a Visão Geral pra comparar todas de uma vez.';
      renderMidiasBrandSwitch();
      renderMidiasHubBody();
    } catch (e) {
      $('#midiasHubHint').textContent = e.message;
    }
  }

  function renderMidiasBrandSwitch() {
    const wrap = $('#midiasBrandSwitch');
    const brands = (midiasMeta && midiasMeta.brands) || [];
    wrap.innerHTML = brands.map((b) => `<button class="btn-secondary" data-midias-brand="${b.id}" style="${b.id === midiasBrand ? `background:${b.accent};color:#fff;border-color:${b.accent};` : ''}">${b.label}</button>`).join('');
    wrap.querySelectorAll('[data-midias-brand]').forEach((btn) => {
      btn.onclick = () => {
        midiasBrand = btn.dataset.midiasBrand;
        renderMidiasBrandSwitch();
        renderMidiasHubBody();
      };
    });
  }

  function renderMidiasHubBody() {
    $('#midiasHubOverviewCard').innerHTML = `
      <div class="dash-card" style="max-width:340px;margin-bottom:18px;" data-open-midias-overview="1">
        <span class="tag">Visão Geral</span>
        <h3>Panorama de todas as redes</h3>
        <p>Compare seguidores, alcance e os conteúdos que mais se destacaram, todas as redes juntas.</p>
        <button>Abrir →</button>
      </div>`;
    $('#midiasHubOverviewCard [data-open-midias-overview]').querySelector('button').onclick = () => openMidiasChannel(null, false);

    const channels = midiasChannelsForBrand(midiasBrand);
    const groups = {};
    channels.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    $('#midiasHubGroups').innerHTML = Object.keys(groups).map((groupName) => `
      <h3 style="margin:18px 0 10px;">${groupName}</h3>
      <div class="card-grid">
        ${groups[groupName].map((c) => `
          <div class="dash-card" data-open-midias-channel="${c.id}">
            <h3><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};margin-right:8px;"></span>${c.label}</h3>
            <p>Métricas, conteúdos em destaque e histórico desta rede.</p>
            <button>Abrir →</button>
          </div>`).join('')}
      </div>`).join('');
    $all('[data-open-midias-channel]').forEach((card) => {
      card.querySelector('button').onclick = () => openMidiasChannel(card.dataset.openMidiasChannel, false);
    });
  }

  function midiasIframeSrc(baseUrl, view) {
    const params = new URLSearchParams();
    params.set('embedBrand', midiasBrand);
    if (view === 'channel') { params.set('embedView', 'channel'); params.set('embedChannel', midiasChannelId); }
    else if (view === 'audit') { params.set('embedView', 'audit'); params.set('embedChannel', midiasChannelId); }
    else { params.set('embedView', 'overview'); }
    return baseUrl.replace(/\/$/, '') + '/?' + params.toString();
  }

  async function openMidiasChannel(channelId, historyMode) {
    midiasChannelId = channelId;
    midiasHistoryMode = !!historyMode;
    try {
      await loadMidiasMeta();
      const data = await dashboardLaunch('redesSociais');
      // O launch devolve a URL já com o token de login único (?platformToken=...);
      // a base (sem querystring) é o que precisamos pra montar os parâmetros de
      // navegação por cima — o app de Redes Sociais lê os dois juntos no boot.
      const url = new URL(data.url);
      const baseUrl = url.origin;
      const platformParams = url.search; // ?platformToken=...&platformUser=...
      const view = channelId ? (historyMode ? 'audit' : 'channel') : 'overview';
      const navSrc = midiasIframeSrc(baseUrl, view);
      $('#midiasCanalFrame').src = navSrc + '&' + platformParams.slice(1);
      const ch = channelId ? (midiasMeta.channels.find((c) => c.id === channelId) || {}) : null;
      const brandLabel = ((midiasMeta.brands || []).find((b) => b.id === midiasBrand) || {}).label || midiasBrand;
      $('#midiasCanalTitle').textContent = ch ? `${ch.label} — ${brandLabel}` : `Visão Geral — ${brandLabel}`;
      $('#midiasCanalTogglePainel').hidden = !channelId;
      $('#midiasCanalToggleHistorico').hidden = !channelId;
      $('#midiasCanalTogglePainel').classList.toggle('active', !historyMode);
      $('#midiasCanalToggleHistorico').classList.toggle('active', !!historyMode);
      showView('midias-canal');
    } catch (e) {
      alert(e.message);
    }
  }

  $('#midiasCanalBack').onclick = () => openMidiasHub();
  $('#midiasCanalTogglePainel').onclick = () => { if (midiasChannelId) openMidiasChannel(midiasChannelId, false); };
  $('#midiasCanalToggleHistorico').onclick = () => { if (midiasChannelId) openMidiasChannel(midiasChannelId, true); };

  // ---------- Gerenciamento de Trafego Pago (27a rodada) ----------
  // Mesmo tratamento dado ao Gerenciamento de Midias: em vez de abrir o
  // painel de Trafego Pago inteiro (com a barra de abas dele) num iframe
  // so, esta tela e uma "central" nativa com um card por secao do painel
  // de origem. Ao escolher uma, abre um iframe so com o CONTEUDO daquela
  // secao (a barra de abas do outro painel fica escondida — ver
  // .embedded-in-platform no index.html dele), ja na marca certa.
  //
  // Diferente do Midias, aqui a lista de secoes e fixa (nao vem de um
  // endpoint) porque o painel de Trafego Pago nao tem o conceito de
  // "redes" — as secoes de hoje ja sao as abas que o proprio painel usa
  // (Planejamento, Resultados, etc.), entao ficaram hardcoded aqui; se um
  // dia o painel ganhar uma aba nova, basta acrescentar 1 linha nesta
  // lista.
  const TRAFEGO_BRANDS = [
    { id: 'ghelplus', label: 'GhelPlus' },
    { id: 'debacco', label: 'De Bacco' }
  ];
  const TRAFEGO_SECTIONS = [
    { id: 'planning', label: 'Planejamento', desc: 'Cronograma de campanhas por trimestre, com objetivo, público-alvo e KPIs.' },
    { id: 'results', label: 'Resultados', desc: 'Indicadores por campanha, comparador entre campanhas e funil de conversão.' },
    { id: 'summary', label: 'Resumo Campanhas', desc: 'Visão consolidada de todas as campanhas cadastradas.' },
    { id: 'monthly', label: 'Métricas mensais', desc: 'Investimento, receita e conversões lançados mês a mês.' },
    { id: 'archive', label: 'Planejamentos anteriores', desc: 'Campanhas de anos passados, separadas automaticamente pela data.' },
    { id: 'yearly', label: 'Comparativo anual', desc: 'Compara os anos lado a lado: campanhas, orçado, investido e receita.' },
    { id: 'audit', label: 'Histórico de alterações', desc: 'Quem criou, editou ou excluiu o quê e quando.' }
  ];
  let trafegoBrand = 'ghelplus';

  function openTrafegoHub() {
    showView('trafego-hub');
    // Mesmo cuidado do Mídias: some com os controles de "Link externo" pra
    // quem já entrou por um link externo (28ª rodada).
    $('#trafegoHubPublicLinkBtn').hidden = !!dashboardPublicToken;
    if (dashboardPublicToken) $('#trafegoPublicLinkPanel').hidden = true;
    renderTrafegoBrandSwitch();
    renderTrafegoHubBody();
  }

  function renderTrafegoBrandSwitch() {
    const wrap = $('#trafegoBrandSwitch');
    wrap.innerHTML = TRAFEGO_BRANDS.map((b) => `<button class="btn-secondary${b.id === trafegoBrand ? ' active' : ''}" data-trafego-brand="${b.id}">${b.label}</button>`).join('');
    wrap.querySelectorAll('[data-trafego-brand]').forEach((btn) => {
      btn.onclick = () => {
        trafegoBrand = btn.dataset.trafegoBrand;
        renderTrafegoBrandSwitch();
      };
    });
  }

  function renderTrafegoHubBody() {
    $('#trafegoHubGroups').innerHTML = `
      <div class="card-grid">
        ${TRAFEGO_SECTIONS.map((s) => `
          <div class="dash-card" data-open-trafego-section="${s.id}">
            <h3>${s.label}</h3>
            <p>${s.desc}</p>
            <button>Abrir →</button>
          </div>`).join('')}
      </div>`;
    $all('[data-open-trafego-section]').forEach((card) => {
      card.querySelector('button').onclick = () => openTrafegoSection(card.dataset.openTrafegoSection);
    });
  }

  async function openTrafegoSection(sectionId) {
    try {
      const data = await dashboardLaunch('trafegoPago');
      // O launch devolve a URL ja com o token de login unico (?platformToken=...);
      // a base (sem querystring) e o que precisamos pra montar os parametros de
      // navegacao por cima — o painel de Trafego Pago le os dois juntos no boot.
      const url = new URL(data.url);
      const baseUrl = url.origin;
      const platformParams = url.search; // ?platformToken=...&platformUser=...
      const params = new URLSearchParams();
      params.set('embedBrand', trafegoBrand);
      params.set('embedView', sectionId);
      const navSrc = baseUrl.replace(/\/$/, '') + '/?' + params.toString();
      $('#trafegoTelaFrame').src = navSrc + '&' + platformParams.slice(1);
      const section = TRAFEGO_SECTIONS.find((s) => s.id === sectionId) || {};
      const brandLabel = (TRAFEGO_BRANDS.find((b) => b.id === trafegoBrand) || {}).label || trafegoBrand;
      $('#trafegoTelaTitle').textContent = `${section.label || ''} — ${brandLabel}`;
      showView('trafego-tela');
    } catch (e) {
      alert(e.message);
    }
  }

  $('#trafegoTelaBack').onclick = () => openTrafegoHub();
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

  // Cores fixas do gráfico Planejado x Realizado (25ª rodada) — validadas
  // com o script do skill de dataviz (validate_palette.js): separação boa
  // pra daltonismo (ΔE ~17), sempre nessa ordem (nunca sorteadas/cicladas).
  const BUDGET_CHART_COLOR_PLAN = '#6FA9FE';
  const BUDGET_CHART_COLOR_REAL = '#6D63E0';

  function fillBudgetSearchFluxo(brand) {
    const sel = $('#budgetSearchFluxo');
    const fluxos = budgetFluxosByBrand[brand] || [];
    sel.innerHTML = '<option value="">Todos os fluxos</option>' + fluxos.map((f) => `<option value="${f}">${f}</option>`).join('');
  }
  function fillBudgetSearchMonth() {
    const sel = $('#budgetSearchMonth');
    sel.innerHTML = '<option value="">Todos os meses</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  }
  fillBudgetSearchMonth();
  function clearBudgetSearch() {
    $('#budgetSearchFluxo').value = '';
    $('#budgetSearchMonth').value = '';
    $('#budgetSearchFornecedor').value = '';
    $('#budgetSearchTitulo').value = '';
    $('#budgetSearchValor').value = '';
  }
  ['#budgetSearchFluxo', '#budgetSearchMonth', '#budgetSearchFornecedor', '#budgetSearchTitulo', '#budgetSearchValor'].forEach((sel) => {
    $(sel).addEventListener('input', renderBudget);
  });
  $('#budgetSearchClear').onclick = () => { clearBudgetSearch(); renderBudget(); };

  async function openBudget(brand) {
    currentBudgetBrand = brand;
    $('#budgetTitle').textContent = 'Budget — ' + (BRAND_LABEL[brand] || brand);
    showView('budget');
    if (!budgetFluxosByBrand[brand]) {
      try {
        const meta = await api('/api/budget/meta?brand=' + encodeURIComponent(brand));
        budgetFluxosByBrand[brand] = meta.fluxos;
      } catch (e) { /* sem acesso */ }
    }
    $('#budgetFormCategory').innerHTML = (budgetFluxosByBrand[brand] || []).map((f) => `<option value="${f}">${f}</option>`).join('');
    clearBudgetSearch();
    fillBudgetSearchFluxo(brand);
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

  // Uma linha "bate" com o planejado, estourou o planejado, ou é um gasto
  // que não tinha nada planejado — usado tanto pra colorir a linha quanto
  // pra decidir o sinal do valor Realizado/Diferença (25ª rodada).
  function budgetEntryStatus(e) {
    const planVal = (e.planejado === null || e.planejado === undefined || e.planejado === '') ? null : Number(e.planejado);
    const realVal = (e.realizado === null || e.realizado === undefined || e.realizado === '') ? null : Number(e.realizado);
    const hasPlan = planVal !== null && planVal > 0;
    const hasReal = realVal !== null && realVal > 0;
    const isUnplanned = hasReal && !hasPlan;
    const isOverBudget = hasPlan && hasReal && realVal > planVal;
    return { planVal, realVal, hasPlan, hasReal, isUnplanned, isOverBudget };
  }

  function passesBudgetSearch(e) {
    const fluxo = $('#budgetSearchFluxo').value;
    const month = $('#budgetSearchMonth').value;
    const fornecedor = $('#budgetSearchFornecedor').value.trim().toLowerCase();
    const titulo = $('#budgetSearchTitulo').value.trim().toLowerCase();
    const valorRaw = $('#budgetSearchValor').value;
    if (fluxo && e.category !== fluxo) return false;
    if (month && String(e.month) !== String(month)) return false;
    if (fornecedor && !(e.fornecedor || '').toLowerCase().includes(fornecedor)) return false;
    if (titulo && !(e.tituloCompra || '').toLowerCase().includes(titulo)) return false;
    if (valorRaw !== '') {
      const val = Number(valorRaw);
      const matchesPlan = e.planejado !== null && e.planejado !== undefined && Math.abs(Number(e.planejado) - val) < 0.005;
      const matchesReal = e.realizado !== null && e.realizado !== undefined && Math.abs(Number(e.realizado) - val) < 0.005;
      if (!matchesPlan && !matchesReal) return false;
    }
    return true;
  }

  function renderBudget() {
    const canEdit = budgetAccess === 'editor' || budgetAccess === 'admin';
    $('#budgetTableWrap').hidden = budgetTab === 'comparativo';
    $('#budgetComparativoWrap').hidden = budgetTab !== 'comparativo';
    $('#budgetNewBtn').hidden = !canEdit || budgetTab === 'comparativo';

    let rows = budgetEntries;
    if (budgetTab === 'planejado') rows = rows.filter((e) => e.planejado !== null && e.planejado !== undefined);
    if (budgetTab === 'realizado') rows = rows.filter((e) => e.realizado !== null && e.realizado !== undefined);
    rows = rows.filter(passesBudgetSearch);

    const totalPlan = rows.reduce((s, e) => s + (Number(e.planejado) || 0), 0);
    const totalReal = rows.reduce((s, e) => s + (Number(e.realizado) || 0), 0);
    $('#sumPlanejado').textContent = fmtMoney(totalPlan);
    $('#sumRealizado').textContent = fmtMoney(totalReal);
    $('#sumDiferenca').textContent = fmtMoney(totalReal - totalPlan);

    const body = $('#budgetTableBody');
    body.innerHTML = '';
    $('#budgetEmpty').hidden = rows.length > 0;
    if (rows.length === 0) $('#budgetEmpty').textContent = 'Nenhum lançamento encontrado.';
    rows.forEach((e) => {
      const st = budgetEntryStatus(e);
      // Diferença = planejado - realizado (quanto sobrou do orçamento).
      // Fica negativa (e em vermelho) quando o realizado estourou o
      // planejado — foi assim que a Raquel pediu pra sinalizar (25ª rodada).
      const diff = (st.planVal || 0) - (st.realVal || 0);
      const tr = document.createElement('tr');
      if (st.isOverBudget) tr.classList.add('row-over');
      else if (st.isUnplanned) tr.classList.add('row-unplanned');
      const realizadoHtml = st.isOverBudget
        ? `<span class="text-danger">-${fmtMoney(st.realVal)}</span>`
        : fmtMoney(e.realizado);
      const diffHtml = st.isOverBudget
        ? `<span class="text-danger">${fmtMoney(diff)}</span>`
        : fmtMoney(diff);
      tr.innerHTML = `
        <td>${e.category}</td>
        <td>${MONTHS[e.month - 1] || e.month}/${e.year}</td>
        <td>${e.fornecedor || ''}</td>
        <td>${e.tituloCompra || ''}</td>
        <td class="num">${e.quantidade === null || e.quantidade === undefined ? '' : e.quantidade}</td>
        <td class="num">${fmtMoney(e.planejado)}</td>
        <td class="num">${realizadoHtml}</td>
        <td class="num">${diffHtml}</td>
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
    renderBudgetChart();
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
      const over = v.planejado > 0 && v.realizado > v.planejado;
      const tr = document.createElement('tr');
      if (over) tr.classList.add('row-over');
      tr.innerHTML = `
        <td>${fluxo}</td>
        <td class="num">${fmtMoney(v.planejado)}</td>
        <td class="num">${fmtMoney(v.realizado)}</td>
        <td class="num${over ? ' text-danger' : ''}">${fmtMoney(diff)}</td>
        <td class="num">${pct === null ? 'sem planejado' : pct.toFixed(0) + '%'}</td>
      `;
      body.appendChild(tr);
    });
  }

  // ---------- Gráfico Planejado x Realizado por mês (25ª rodada) ----------
  // Reproduz o gráfico que existia no fim das planilhas de budget originais
  // — se atualiza sozinho porque lê direto de `budgetEntries`, recarregado
  // toda vez que um lançamento é criado/editado/excluído.
  function fmtMoneyShort(n) {
    if (n >= 1000000) return 'R$ ' + (n / 1000000).toFixed(1).replace('.', ',') + 'mi';
    if (n >= 1000) return 'R$ ' + Math.round(n / 1000) + 'mil';
    return 'R$ ' + Math.round(n);
  }
  function renderBudgetChart() {
    const wrap = $('#budgetChartWrap');
    if (!wrap) return;
    const byMonth = {};
    for (let m = 1; m <= 12; m++) byMonth[m] = { planejado: 0, realizado: 0 };
    budgetEntries.forEach((e) => {
      if (!byMonth[e.month]) return;
      byMonth[e.month].planejado += Number(e.planejado) || 0;
      byMonth[e.month].realizado += Number(e.realizado) || 0;
    });
    const months = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
    const hasAnyData = months.some((m) => byMonth[m].planejado > 0 || byMonth[m].realizado > 0);
    if (!hasAnyData) {
      wrap.innerHTML = '<p class="muted budget-chart-empty">Sem lançamentos suficientes pra montar o gráfico ainda.</p>';
      return;
    }
    const maxVal = Math.max(1, ...months.map((m) => Math.max(byMonth[m].planejado, byMonth[m].realizado)));
    const chartW = 900, chartH = 260;
    const padL = 54, padB = 30, padT = 14, padR = 10;
    const plotW = chartW - padL - padR;
    const plotH = chartH - padT - padB;
    const groupW = plotW / months.length;
    const barW = Math.min(16, groupW * 0.32);
    const gap = 3;
    const yTicks = 4;
    let gridSvg = '';
    for (let t = 0; t <= yTicks; t++) {
      const v = (maxVal / yTicks) * t;
      const y = padT + plotH - (v / maxVal) * plotH;
      gridSvg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${chartW - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"></line>`;
      gridSvg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtMoneyShort(v)}</text>`;
    }
    let barsSvg = '';
    let labelsSvg = '';
    months.forEach((m, i) => {
      const groupX = padL + i * groupW;
      const plan = byMonth[m].planejado;
      const real = byMonth[m].realizado;
      const planH = (plan / maxVal) * plotH;
      const realH = (real / maxVal) * plotH;
      const x1 = groupX + groupW / 2 - barW - gap / 2;
      const x2 = groupX + groupW / 2 + gap / 2;
      const yPlan = padT + plotH - planH;
      const yReal = padT + plotH - realH;
      barsSvg += `
        <rect x="${x1.toFixed(1)}" y="${yPlan.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(planH, 0).toFixed(1)}" rx="3" fill="${BUDGET_CHART_COLOR_PLAN}"><title>${MONTHS[m - 1]} · Planejado: ${fmtMoney(plan)}</title></rect>
        <rect x="${x2.toFixed(1)}" y="${yReal.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(realH, 0).toFixed(1)}" rx="3" fill="${BUDGET_CHART_COLOR_REAL}"><title>${MONTHS[m - 1]} · Realizado: ${fmtMoney(real)}</title></rect>
      `;
      labelsSvg += `<text x="${(groupX + groupW / 2).toFixed(1)}" y="${chartH - padB + 16}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${MONTHS[m - 1]}</text>`;
    });
    wrap.innerHTML = `
      <div class="budget-chart-head">
        <span class="budget-chart-title">Planejado x Realizado por mês</span>
        <span class="budget-chart-legend">
          <span class="budget-chart-legend-item"><span class="budget-chart-dot" style="background:${BUDGET_CHART_COLOR_PLAN}"></span>Planejado</span>
          <span class="budget-chart-legend-item"><span class="budget-chart-dot" style="background:${BUDGET_CHART_COLOR_REAL}"></span>Realizado</span>
        </span>
      </div>
      <svg viewBox="0 0 ${chartW} ${chartH}" class="budget-chart-svg" role="img" aria-label="Gráfico de planejado e realizado por mês">
        ${gridSvg}
        ${barsSvg}
        ${labelsSvg}
      </svg>
    `;
  }

  function openBudgetForm(entry) {
    editingBudgetId = entry ? entry.id : null;
    $('#budgetFormTitle').textContent = entry ? 'Editar lançamento' : 'Novo lançamento';
    $('#budgetFormBrand').value = currentBudgetBrand;
    $('#budgetFormCategory').value = entry ? entry.category : ((budgetFluxosByBrand[currentBudgetBrand] || [])[0] || '');
    $('#budgetFormYear').value = entry ? entry.year : new Date().getFullYear();
    $('#budgetFormMonth').value = entry ? entry.month : new Date().getMonth() + 1;
    $('#budgetFormPlanejado').value = entry && entry.planejado !== null ? entry.planejado : '';
    $('#budgetFormRealizado').value = entry && entry.realizado !== null ? entry.realizado : '';
    $('#budgetFormFornecedor').value = entry ? entry.fornecedor || '' : '';
    $('#budgetFormTitulo').value = entry ? entry.tituloCompra || '' : '';
    $('#budgetFormQuantidade').value = entry && entry.quantidade !== null && entry.quantidade !== undefined ? entry.quantidade : '';
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
      fornecedor: $('#budgetFormFornecedor').value.trim(),
      tituloCompra: $('#budgetFormTitulo').value.trim(),
      quantidade: $('#budgetFormQuantidade').value,
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

  // No quadro geral, uma coluna por membro da equipe — a coluna "Sem
  // responsável" foi removida a pedido da Raquel; toda demanda do quadro
  // geral agora exige pelo menos um responsável marcado (ver validação em
  // #demCardSave). Na área pessoal, só aparecem colunas relevantes: eu
  // (sempre primeiro) e quem mais eu tiver marcado em alguma demanda
  // pessoal visível pra mim.
  // Ordem pessoal das colunas (17ª rodada): cada pessoa pode arrastar as
  // listas pra organizar do jeito que quiser — não afeta o que os outros
  // enxergam. Quem ainda não está na lista salva (gente nova, por exemplo)
  // aparece depois, na ordem padrão de sempre.
  function applyColumnOrder(columns) {
    const order = (currentUser && currentUser.columnOrder) || [];
    if (order.length === 0) return columns;
    const rank = new Map(order.map((id, i) => [id, i]));
    return columns
      .map((col, i) => ({ col, i }))
      .sort((a, b) => {
        const ra = rank.has(a.col.id) ? rank.get(a.col.id) : 1000 + a.i;
        const rb = rank.has(b.col.id) ? rank.get(b.col.id) : 1000 + b.i;
        return ra - rb;
      })
      .map((x) => x.col);
  }

  function kanbanColumns() {
    if (demandasScope === 'geral') return applyColumnOrder(teamMembers);
    const me = { id: currentUser.id, name: (currentUser.name || currentUser.username) + ' (você)', columnColor: currentUser.columnColor || null };
    const others = new Set();
    demandas.forEach((d) => (d.assigneeIds || []).forEach((id) => { if (id !== currentUser.id) others.add(id); }));
    const otherCols = teamMembers.filter((m) => others.has(m.id));
    return applyColumnOrder([me].concat(otherCols));
  }

  // Persiste a nova ordem depois de soltar uma coluna arrastada (17ª rodada).
  async function saveColumnOrder(order) {
    currentUser.columnOrder = order;
    try {
      await api('/api/auth/me/column-order', { method: 'PUT', body: JSON.stringify({ order }) });
    } catch (e) { /* ignora falha pontual — a ordem local já foi aplicada */ }
  }

  function demandaInColumn(d, colId) {
    const ids = d.assigneeIds || [];
    if (demandasScope === 'pessoal' && ids.length === 0) return colId === currentUser.id;
    if (colId === '') return ids.length === 0;
    return ids.includes(colId);
  }

  // Marca (ou desmarca) uma demanda como concluída direto pelo card, sem
  // precisar abrir o modal (17ª rodada, pedido da Raquel: "ao realizar a
  // tarefa, deve ter a opção de clicar no card e a tarefa ser finalizada").
  // Se a demanda for recorrente, reaproveita a mesma lógica do backend que
  // já existia (15ª rodada): em vez de ficar concluída, ela volta sozinha
  // pra "A Fazer" com a data empurrada pro mês seguinte.
  async function toggleDemandaConcluida(d) {
    const novoStatus = d.status === 'concluida' ? 'a_fazer' : 'concluida';
    try {
      const result = await api('/api/demandas/' + d.id, { method: 'PUT', body: JSON.stringify({ status: novoStatus }) });
      if (result.recurringReset) {
        alert(`Demanda recorrente: essa entrega foi concluída e a demanda voltou pra "A Fazer", com a próxima data em ${fmtDate(result.recurringReset)}.`);
      }
      await loadDemandas();
    } catch (e) {
      alert(e.message || 'Não foi possível atualizar a demanda.');
    }
  }

  // Menor valor "seguro" entre duas ordens vizinhas, pra encaixar um card
  // arrastado entre elas sem precisar renumerar a lista inteira (21ª
  // rodada). Quando não tem vizinho de um dos lados (soltou no topo ou no
  // fim da lista), afasta 1000 do único vizinho que existe — dá espaço de
  // sobra pra próximos ajustes sem colidir.
  function computeOrderBetween(prevOrder, nextOrder) {
    if (prevOrder == null && nextOrder == null) return Date.now();
    if (prevOrder == null) return nextOrder - 1000;
    if (nextOrder == null) return prevOrder + 1000;
    return (prevOrder + nextOrder) / 2;
  }

  // Reposiciona um card arrastado (targetId = null solta no fim da lista).
  // Atualiza a ordem local na hora (otimista, pra não esperar o servidor
  // pra já ver o card no lugar certo) e persiste em seguida — se a chamada
  // falhar, a ordem local já aplicada fica valendo até o próximo loadDemandas().
  async function reorderCardTo(items, draggedId, targetId) {
    const dragged = demandas.find((x) => x.id === draggedId);
    if (!dragged) return;
    const withoutDragged = items.filter((x) => x.id !== draggedId);
    let insertAt = targetId ? withoutDragged.findIndex((x) => x.id === targetId) : withoutDragged.length;
    if (insertAt === -1) insertAt = withoutDragged.length;
    const prev = withoutDragged[insertAt - 1];
    const next = withoutDragged[insertAt];
    const newOrder = computeOrderBetween(prev ? prev.order : null, next ? next.order : null);
    dragged.order = newOrder;
    draggedCardId = null;
    renderKanban();
    try {
      await api('/api/demandas/reorder', { method: 'PUT', body: JSON.stringify({ items: [{ id: draggedId, order: newOrder }] }) });
    } catch (e) { /* ignora falha pontual — a ordem local já foi aplicada */ }
  }

  // "Ordenar por data" (21ª rodada, pedido da Raquel: "deve ter a
  // possibilidade de organizar a lista por data") — reordena de uma vez só
  // os cards dessa lista pela data de entrega (sem data vai pro fim),
  // renumerando a ordem manual de todos eles.
  async function sortColumnByDate(items) {
    if (items.length === 0) return;
    const sorted = [...items].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    const base = Date.now();
    const changes = sorted.map((d, i) => ({ id: d.id, order: base + i * 1000 }));
    changes.forEach((c) => {
      const dem = demandas.find((x) => x.id === c.id);
      if (dem) dem.order = c.order;
    });
    renderKanban();
    try {
      await api('/api/demandas/reorder', { method: 'PUT', body: JSON.stringify({ items: changes }) });
    } catch (e) { alert('Não foi possível salvar a nova ordem por data.'); }
  }

  function renderKanban() {
    const board = $('#kanbanBoard');
    board.innerHTML = '';
    const columns = kanbanColumns();
    columns.forEach((member) => {
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      // Ordem manual dos cards dentro da lista (21ª rodada) — arrastável;
      // "order" sempre vem preenchido pelo backend (ver cardOrder() em
      // routes/demandas.js), inclusive pra demandas antigas sem esse campo.
      const items = demandas.filter((d) => demandaInColumn(d, member.id)).sort((a, b) => a.order - b.order);
      colEl.innerHTML = `<div class="kanban-col-header"><span class="kanban-col-drag-handle" title="Arrastar para reordenar as listas">⠿</span><span class="kanban-col-header-name">${member.name}</span><button type="button" class="kanban-sort-date-btn" title="Organizar esta lista por data de entrega">📅</button><button type="button" class="color-dot-btn" title="Cor da lista"></button><span class="kanban-count">${items.length}</span></div>`;
      colEl.querySelector('.kanban-sort-date-btn').onclick = (e) => {
        e.stopPropagation();
        sortColumnByDate(items);
      };
      // Cor customizável da lista (13ª rodada, pedido da Raquel) — mesmo
      // tom claro (color-mix) já usado nos cards, só que mais suave por
      // cobrir uma área bem maior, mais um topo colorido pra destacar.
      const colorBtn = colEl.querySelector('.color-dot-btn');
      setColorDotBtn(colorBtn, member.columnColor || null);
      if (member.columnColor) {
        colEl.style.background = `color-mix(in srgb, ${member.columnColor} 10%, white)`;
        colEl.style.borderTop = `3px solid ${member.columnColor}`;
      }
      colorBtn.onclick = (e) => {
        e.stopPropagation();
        openColorPopover(colorBtn, member.columnColor || null, async (color) => {
          await api('/api/auth/team/' + member.id + '/color', { method: 'PUT', body: JSON.stringify({ color }) });
          const tm = teamMembers.find((m) => m.id === member.id);
          if (tm) tm.columnColor = color;
          if (currentUser.id === member.id) currentUser.columnColor = color;
          renderKanban();
        });
      };

      // Arrastar e soltar pra reordenar as listas — preferência pessoal de
      // quem está vendo (17ª rodada), não muda a ordem que os outros veem.
      colEl.draggable = true;
      colEl.dataset.colId = member.id;
      colEl.addEventListener('dragstart', (e) => {
        draggedColId = member.id;
        colEl.classList.add('dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      colEl.addEventListener('dragend', () => colEl.classList.remove('dragging'));
      colEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedColId && draggedColId !== member.id) colEl.classList.add('drag-over');
      });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        if (!draggedColId || draggedColId === member.id) return;
        const order = columns.map((c) => c.id);
        const fromIdx = order.indexOf(draggedColId);
        const toIdx = order.indexOf(member.id);
        if (fromIdx === -1 || toIdx === -1) return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, draggedColId);
        draggedColId = null;
        saveColumnOrder(order);
        renderKanban();
      });

      const list = document.createElement('div');
      list.className = 'kanban-list';
      if (items.length === 0) {
        list.innerHTML = '<div class="kanban-empty">Sem demandas</div>';
      }
      // Soltar na área vazia da lista (abaixo do último card, ou lista sem
      // nenhum card ainda) manda o card arrastado pro fim dela (21ª
      // rodada). stopPropagation em tudo aqui pra não se confundir com o
      // drag-and-drop das LISTAS (colEl, algumas linhas acima) — sem isso
      // arrastar um card também dispararia o dragstart/drop da coluna.
      // draggedCardInThisList() trava o reordenar só dentro da MESMA lista
      // — mesmo card aparecendo em duas colunas (vários responsáveis) não
      // é o caso comum, e mover entre colunas mudaria quem é responsável,
      // o que não foi pedido aqui (só reordenar dentro da lista).
      const draggedCardInThisList = () => draggedCardId && items.some((x) => x.id === draggedCardId);
      list.addEventListener('dragover', (e) => {
        if (!draggedCardInThisList()) return;
        e.preventDefault();
        e.stopPropagation();
        list.classList.add('drag-over-list');
      });
      list.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        list.classList.remove('drag-over-list');
      });
      list.addEventListener('drop', (e) => {
        if (!draggedCardInThisList()) return;
        e.preventDefault();
        e.stopPropagation();
        list.classList.remove('drag-over-list');
        reorderCardTo(items, draggedCardId, null);
      });
      items.forEach((d) => {
        const card = document.createElement('div');
        card.className = 'kanban-card' + (d.overdue ? ' overdue' : '') + (d.status === 'concluida' ? ' is-done' : '');
        const doneCount = (d.checklist || []).filter((c) => c.done).length;
        const total = (d.checklist || []).length;
        const cardLabels = (d.labelIds || []).map(labelById).filter(Boolean);
        card.innerHTML = `
          ${cardLabels.length > 0 ? `<div class="kanban-card-labels">${cardLabels.map((l) => `<span class="kanban-label-chip" title="${l.name}" style="background:${l.color}"></span>`).join('')}</div>` : ''}
          <div class="kanban-card-title-row">
            <button type="button" class="kanban-check-btn${d.status === 'concluida' ? ' checked' : ''}" title="${d.status === 'concluida' ? 'Marcar como não concluída' : 'Marcar como concluída'}"></button>
            <div class="kanban-card-title">${d.title}</div>
          </div>
          <div class="kanban-card-meta">
            <span class="badge">${statusLabel(d.status)}</span>
            ${d.dueDate ? `<span class="badge ${d.overdue ? 'badge-danger' : ''}">${fmtDate(d.dueDate)}</span>` : ''}
            ${d.recurring ? '<span class="badge badge-muted" title="Repete todo mês">↻ mensal</span>' : ''}
            ${(d.assigneeIds || []).length > 1 ? `<span class="badge">${d.assigneeIds.length} pessoas</span>` : ''}
            ${total > 0 ? `<span class="badge">✓ ${doneCount}/${total}</span>` : ''}
            ${(d.files || []).length > 0 ? `<span class="badge">📎 ${d.files.length}</span>` : ''}
            ${d.link ? '<span class="badge" title="Tem link">🔗</span>' : ''}
          </div>
          ${d.createdByName ? `<div class="kanban-card-creator">Criado por: ${d.createdByName}</div>` : ''}
        `;
        if (d.color) {
          // Tom claro (mistura com branco) pra manter o texto legível — a
          // cor cheia fica só na barra da borda esquerda, como um "aceno"
          // de cor sem virar um card ilegível.
          card.style.background = `color-mix(in srgb, ${d.color} 18%, white)`;
          card.style.borderLeftColor = d.color;
          card.style.borderLeftWidth = '4px';
        }
        card.onclick = () => openDemandaModal(d);
        const checkBtn = card.querySelector('.kanban-check-btn');
        checkBtn.onclick = (e) => {
          e.stopPropagation();
          toggleDemandaConcluida(d);
        };

        // Arrastar pra reordenar dentro da lista (21ª rodada, pedido da
        // Raquel: "os cards dentro das listas devem poder ser mudados de
        // ordem ao puxar"). stopPropagation em todo evento de drag do card
        // pra não borbulhar pro dragstart/drop da COLUNA (colEl também é
        // draggable, pra reordenar as listas — são dois sistemas de
        // arrastar independentes, um dentro do outro).
        card.draggable = true;
        card.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          draggedCardId = d.id;
          card.classList.add('card-dragging');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', (e) => {
          e.stopPropagation();
          card.classList.remove('card-dragging');
        });
        card.addEventListener('dragover', (e) => {
          if (!draggedCardInThisList() || draggedCardId === d.id) return;
          e.preventDefault();
          e.stopPropagation();
          card.classList.add('drag-over-card');
        });
        card.addEventListener('dragleave', (e) => {
          e.stopPropagation();
          card.classList.remove('drag-over-card');
        });
        card.addEventListener('drop', (e) => {
          if (!draggedCardInThisList() || draggedCardId === d.id) return;
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove('drag-over-card');
          reorderCardTo(items, draggedCardId, d.id);
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
    // Card ainda não salvo (editingDemandaId null): trabalha em cima do
    // rascunho local (draftChecklist), sem chamar a API — é o que libera o
    // checklist antes de o card existir (26ª rodada).
    const isDraft = !editingDemandaId;
    const wrap = $('#demChecklist');
    wrap.innerHTML = '';
    const list = isDraft ? draftChecklist : (demanda.checklist || []);
    const done = list.filter((c) => c.done).length;
    $('#demChecklistProgress').hidden = list.length === 0;
    if (list.length > 0) {
      $('#demChecklistProgressBar').style.width = Math.round((done / list.length) * 100) + '%';
    }
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'checklist-item';
      row.innerHTML = `<label><input type="checkbox" ${item.done ? 'checked' : ''}> <span>${item.text}</span></label>`;
      row.querySelector('input').onchange = async (ev) => {
        if (isDraft) {
          item.done = ev.target.checked;
          return;
        }
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ done: ev.target.checked }) });
        editingDemandaId = demanda.id;
        await refreshOpenDemanda();
      };
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        if (isDraft) {
          const idx = draftChecklist.indexOf(item);
          if (idx !== -1) draftChecklist.splice(idx, 1);
          renderChecklist(demanda);
          return;
        }
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
      loadDemHistory(fresh.id);
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

  // Etiquetas pessoais (26ª rodada) só valem dentro da área pessoal de quem
  // criou — no quadro geral, a lista de etiquetas (pra usar no card ou pra
  // gerenciar) mostra só as globais, mesmo que o servidor também devolva as
  // pessoais dessa pessoa (usadas em outro contexto).
  function visibleLabelsForScope() {
    if (demandasScope === 'pessoal') return labels;
    return labels.filter((l) => !l.ownerId);
  }

  function renderLabelChips() {
    const wrap = $('#demLabelList');
    wrap.innerHTML = '';
    const scoped = visibleLabelsForScope();
    if (scoped.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhuma etiqueta ainda — clique em "gerenciar etiquetas" para criar.</span>';
      return;
    }
    scoped.forEach((l) => {
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

  function renderDemColorSwatches() {
    const wrap = $('#demColorSwatches');
    wrap.innerHTML = '';
    const none = document.createElement('div');
    none.className = 'color-swatch color-swatch-none' + (selectedDemColor === null ? ' selected' : '');
    none.title = 'Sem cor';
    none.onclick = () => { selectedDemColor = null; renderDemColorSwatches(); };
    wrap.appendChild(none);
    labelSuggestedColors.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (selectedDemColor === c ? ' selected' : '');
      sw.style.background = c;
      sw.onclick = () => { selectedDemColor = c; renderDemColorSwatches(); };
      wrap.appendChild(sw);
    });
  }

  function openDemandaModal(demanda) {
    editingDemandaId = demanda ? demanda.id : null;
    openDemandaCache = demanda;
    // Card novo: começa sempre com o rascunho de checklist vazio (26ª rodada).
    draftChecklist = [];
    selectedAssigneeIds = new Set(demanda ? (demanda.assigneeIds || []) : []);
    selectedLabelIds = new Set(demanda ? (demanda.labelIds || []) : []);
    selectedDemColor = demanda ? (demanda.color || null) : null;
    $('#demCardTitle').value = demanda ? demanda.title : '';
    $('#demCardStatus').value = demanda ? demanda.status : 'a_fazer';
    $('#demCardDueDate').value = demanda ? (demanda.dueDate || '') : '';
    $('#demCardRecurring').checked = demanda ? !!demanda.recurring : false;
    $('#demCardRecurringHint').hidden = !$('#demCardRecurring').checked;
    $('#demCardDescription').value = demanda ? (demanda.description || '') : '';
    $('#demCardLink').value = demanda ? (demanda.link || '') : '';
    $('#demChecklistTitle').value = demanda ? (demanda.checklistTitle || 'Checklist') : 'Checklist';
    $('#demCardError').hidden = true;
    $('#demChecklistInput').value = '';
    $('#demFileInput').value = '';
    renderAssigneeChips();
    renderLabelChips();
    renderDemColorSwatches();
    renderChecklist(demanda || { checklist: [] });
    renderFiles(demanda || { files: [] });
    $('#demCardArchive').textContent = demanda && demanda.archived ? 'Desarquivar' : 'Arquivar';
    $('#demCardArchive').hidden = !demanda;
    $('#demCardDelete').hidden = !demanda;
    // O checklist agora fica sempre liberado, mesmo num card ainda não
    // salvo — os itens ficam no rascunho local até o Save (26ª rodada).
    $('#demFileInput').style.display = demanda ? '' : 'none';
    loadDemHistory(demanda ? demanda.id : null);
    $('#demandaModal').hidden = false;
  }
  $('#demCardClose').onclick = () => { $('#demandaModal').hidden = true; loadDemandas(); };
  $('#demCardRecurring').onchange = () => { $('#demCardRecurringHint').hidden = !$('#demCardRecurring').checked; };

  $('#demCardSave').onclick = async () => {
    const payload = {
      title: $('#demCardTitle').value.trim(),
      description: $('#demCardDescription').value,
      status: $('#demCardStatus').value,
      dueDate: $('#demCardDueDate').value || null,
      recurring: $('#demCardRecurring').checked,
      assigneeIds: Array.from(selectedAssigneeIds),
      labelIds: Array.from(selectedLabelIds),
      color: selectedDemColor,
      link: $('#demCardLink').value.trim() || null,
      checklistTitle: $('#demChecklistTitle').value.trim() || 'Checklist',
      visibility: demandasScope
    };
    // Card novo: manda junto os itens de checklist montados no rascunho
    // antes de salvar (26ª rodada) — daí em diante o checklist passa a ser
    // mutado pela API normalmente, como qualquer card já existente.
    if (!editingDemandaId) {
      payload.checklist = draftChecklist;
    }
    if (!payload.title) {
      $('#demCardError').textContent = 'Dê um título para a demanda.';
      $('#demCardError').hidden = false;
      return;
    }
    if (payload.recurring && !payload.dueDate) {
      $('#demCardError').textContent = 'Defina uma data de entrega para usar recorrência.';
      $('#demCardError').hidden = false;
      return;
    }
    // No quadro geral não existe mais coluna "Sem responsável" — exige pelo
    // menos uma pessoa marcada pra a demanda não ficar sem lugar pra
    // aparecer. Na área pessoal continua opcional (cai na própria coluna).
    if (demandasScope === 'geral' && payload.assigneeIds.length === 0) {
      $('#demCardError').textContent = 'Escolha pelo menos um responsável.';
      $('#demCardError').hidden = false;
      return;
    }
    try {
      if (editingDemandaId) {
        const result = await api('/api/demandas/' + editingDemandaId, { method: 'PUT', body: JSON.stringify(payload) });
        if (result.recurringReset) {
          alert(`Demanda recorrente: essa entrega foi concluída e a demanda voltou pra "A Fazer", com a próxima data em ${fmtDate(result.recurringReset)}.`);
        }
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
    if (!text) return;
    if (!editingDemandaId) {
      // Card ainda não salvo: guarda no rascunho local (26ª rodada) — vai
      // junto no payload quando o card for salvo pela primeira vez.
      draftChecklist.push({ text, done: false });
      $('#demChecklistInput').value = '';
      renderChecklist({ checklist: draftChecklist });
      return;
    }
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
    const scoped = visibleLabelsForScope();
    if (scoped.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhuma etiqueta criada ainda.</span>';
      return;
    }
    scoped.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'label-manage-row';
      row.innerHTML = `<span class="label-color-dot" style="background:${l.color}"></span>${l.ownerId ? '<span class="badge badge-muted" title="Só aparece na sua área pessoal">pessoal</span>' : ''}`;
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
    // Etiquetas pessoais (26ª rodada): quem abre o gerenciador a partir da
    // área pessoal cria etiquetas que só aparecem lá — sem checkbox extra,
    // o próprio contexto (aba ativa) já decide.
    $('#labelNewHint').textContent = demandasScope === 'pessoal'
      ? 'Etiquetas criadas aqui aparecem só na sua área pessoal.'
      : 'Etiquetas criadas aqui aparecem no quadro geral, pra todo mundo.';
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
      await api('/api/labels', { method: 'POST', body: JSON.stringify({ name, color: editingLabelColor, personal: demandasScope === 'pessoal' }) });
      $('#labelNewName').value = '';
      await refreshLabels();
    } catch (e) {
      $('#labelModalError').textContent = e.message;
      $('#labelModalError').hidden = false;
    }
  };

  // ---------- Gerenciar equipe (a partir de Demandas) ----------
  // Qualquer pessoa logada pode adicionar ou remover um colega da equipe
  // direto do quadro de Demandas, sem precisar ser administrador da
  // plataforma (a tela Usuários, com permissões e admin, continua só pra
  // super admin). Remover apaga o login dessa pessoa.
  function renderTeamManageList() {
    const wrap = $('#teamManageList');
    wrap.innerHTML = '';
    if (teamMembers.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhuma pessoa cadastrada ainda.</span>';
      return;
    }
    teamMembers.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'label-manage-row';
      const cargoTag = u.cargo ? ` — ${CARGO_LABEL[u.cargo] || u.cargo}` : '';
      const nameSpan = document.createElement('span');
      nameSpan.style.flex = '1';
      nameSpan.style.fontSize = '13px';
      nameSpan.textContent = u.name + cargoTag;
      row.appendChild(nameSpan);
      if (u.id !== currentUser.id) {
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Remover';
        delBtn.className = 'btn-link';
        delBtn.onclick = async () => {
          if (!confirm('Remover "' + u.name + '" da equipe? Isso apaga o login dessa pessoa.')) return;
          try {
            await api('/api/auth/team/' + u.id, { method: 'DELETE' });
            await refreshTeam();
            renderTeamManageList();
          } catch (e) { alert(e.message); }
        };
        row.appendChild(delBtn);
      }
      wrap.appendChild(row);
    });
  }

  async function refreshTeam() {
    const team = await api('/api/auth/team');
    teamMembers = team.users;
    renderKanban();
  }

  function openTeamModal() {
    $('#teamNewName').value = '';
    $('#teamNewUsername').value = '';
    $('#teamNewPassword').value = '';
    $('#teamNewCargo').value = '';
    $('#teamModalError').hidden = true;
    renderTeamManageList();
    $('#teamModal').hidden = false;
  }
  $('#demandasManageTeamBtn').onclick = openTeamModal;
  $('#teamModalClose').onclick = () => { $('#teamModal').hidden = true; };

  $('#teamNewAdd').onclick = async () => {
    const payload = {
      name: $('#teamNewName').value.trim(),
      username: $('#teamNewUsername').value.trim(),
      password: $('#teamNewPassword').value,
      cargo: $('#teamNewCargo').value
    };
    $('#teamModalError').hidden = true;
    if (!payload.name || !payload.username) {
      $('#teamModalError').textContent = 'Informe nome e usuário.';
      $('#teamModalError').hidden = false;
      return;
    }
    if (!payload.password || payload.password.length < 6) {
      $('#teamModalError').textContent = 'Informe uma senha com pelo menos 6 caracteres.';
      $('#teamModalError').hidden = false;
      return;
    }
    try {
      await api('/api/auth/team', { method: 'POST', body: JSON.stringify(payload) });
      $('#teamNewName').value = '';
      $('#teamNewUsername').value = '';
      $('#teamNewPassword').value = '';
      $('#teamNewCargo').value = '';
      await refreshTeam();
      renderTeamManageList();
    } catch (e) {
      $('#teamModalError').textContent = e.message;
      $('#teamModalError').hidden = false;
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
      renderSocialPlatformOptions();
    } catch (e) { /* ignora */ }
  }

  // Duranox e Boutique Inox (20ª rodada) não têm newsletter própria
  // (G-NEWS é da GhelPlus, Contatto é da De Bacco) — pra essas marcas a
  // opção "Newsletter" some da lista de redes, em vez de cair sem querer
  // num nome de newsletter de outra marca.
  function renderSocialPlatformOptions(keepValue) {
    const brand = $('#socialPostFormBrand').value || 'debacco';
    const hasNewsletter = !!NEWSLETTER_TYPE_BY_BRAND[brand];
    const platforms = hasNewsletter ? socialPlatforms : socialPlatforms.filter((p) => p !== 'newsletter');
    $('#socialPostFormPlatform').innerHTML = platforms.map((p) => `<option value="${p}">${SOCIAL_PLATFORM_LABEL[p] || p}</option>`).join('');
    if (keepValue && platforms.includes(keepValue)) $('#socialPostFormPlatform').value = keepValue;
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
    updateCarouselVisibility();
  }

  // Roteiro só faz sentido quando o agendamento é de vídeo (Reels, ou
  // rede TikTok/YouTube).
  function updateScriptVisibility() {
    const platform = $('#socialPostFormPlatform').value;
    const type = $('#socialPostFormType').value;
    const isVideo = socialVideoPostTypes.includes(type) || socialVideoPlatforms.includes(platform);
    $('#socialPostFormScriptWrap').hidden = !isVideo;
  }

  // Briefing por card só faz sentido pra Carrossel — o bloco fica
  // escondido pros outros tipos de post.
  const MAX_CAROUSEL_CARDS_UI = 30;
  function updateCarouselVisibility() {
    const type = $('#socialPostFormType').value;
    $('#socialPostFormCarouselWrap').hidden = (type !== 'carrossel');
  }

  function renderCarouselCards() {
    const wrap = $('#socialPostFormCarouselCards');
    wrap.innerHTML = '';
    socialCarouselBriefings.forEach((text, idx) => {
      const field = document.createElement('div');
      field.className = 'carousel-card-field';
      const label = document.createElement('label');
      label.textContent = `Card ${idx + 1}`;
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = text || '';
      ta.oninput = () => { socialCarouselBriefings[idx] = ta.value; };
      field.appendChild(label);
      field.appendChild(ta);
      wrap.appendChild(field);
    });
  }

  // Ajusta o array de briefings conforme o número de cards informado,
  // mantendo o que já foi digitado nos cards que continuam existindo.
  function setCarouselCount(count) {
    const n = Math.max(1, Math.min(MAX_CAROUSEL_CARDS_UI, Number(count) || 1));
    while (socialCarouselBriefings.length < n) socialCarouselBriefings.push('');
    socialCarouselBriefings.length = n;
    $('#socialPostFormCarouselCount').value = n;
    renderCarouselCards();
  }

  $('#socialPostFormPlatform').onchange = () => updateSocialTypeOptions();
  $('#socialPostFormBrand').onchange = () => {
    const currentPlatform = $('#socialPostFormPlatform').value;
    renderSocialPlatformOptions(currentPlatform);
    updateSocialTypeOptions($('#socialPostFormType').value);
  };
  $('#socialPostFormType').onchange = () => { updateScriptVisibility(); updateCarouselVisibility(); };
  // Usa 'oninput' (não 'onchange') de propósito: 'onchange' só dispara no
  // blur do campo, e como o clique do usuário pra ir digitar no Card 1
  // TIRA o foco do campo de número, o blur disparava o re-render bem na
  // hora do clique — destruindo o textarea que o usuário acabou de clicar
  // e fazendo o clique "sumir". Com 'oninput' o re-render já aconteceu
  // enquanto o campo de número ainda tinha foco, sem essa corrida.
  $('#socialPostFormCarouselCount').oninput = () => setCarouselCount($('#socialPostFormCarouselCount').value);

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
        <td>${(p.subject || '').slice(0, 40)}${(p.subject || '').length > 40 ? '…' : ''}</td>
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
    renderSocialPlatformOptions(post ? post.platform : null);
    updateSocialTypeOptions(post ? (post.postType || 'estatico') : 'estatico');
    $('#socialPostFormStatus').value = post ? post.status : 'rascunho';
    $('#socialPostFormDate').value = post ? post.scheduledDate : '';
    $('#socialPostFormTime').value = post ? (post.scheduledTime || '') : '';
    $('#socialPostFormCaption').value = post ? (post.caption || '') : '';
    $('#socialPostFormSubject').value = post ? (post.subject || '') : '';
    $('#socialPostFormSuggestions').value = post ? (post.changeSuggestions || '') : '';
    if (post && post.changeSuggestions && post.changeSuggestionsBy) {
      $('#socialPostFormSuggestionsMeta').textContent = `Pedido por ${post.changeSuggestionsBy}${post.changeSuggestionsAt ? ' em ' + fmtDateTime(post.changeSuggestionsAt) : ''}`;
      $('#socialPostFormSuggestionsMeta').hidden = false;
    } else {
      $('#socialPostFormSuggestionsMeta').hidden = true;
    }
    $('#socialPostFormLink').value = post ? (post.link || '') : '';
    $('#socialPostFormBriefingText').value = post ? (post.briefingText || '') : '';
    $('#socialPostFormScriptText').value = post ? (post.scriptText || '') : '';
    $('#socialPostFormScriptLink').value = post ? (post.scriptLink || '') : '';

    socialCarouselBriefings = post && Array.isArray(post.carouselBriefings) && post.carouselBriefings.length > 0
      ? [...post.carouselBriefings]
      : [''];
    $('#socialPostFormCarouselCount').value = socialCarouselBriefings.length;
    renderCarouselCards();

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
      subject: $('#socialPostFormSubject').value,
      involvedUserIds: Array.from(socialInvolvedIds),
      changeSuggestions: $('#socialPostFormSuggestions').value,
      link: $('#socialPostFormLink').value,
      briefingText: $('#socialPostFormBriefingText').value,
      scriptText: $('#socialPostFormScriptText').value,
      scriptLink: $('#socialPostFormScriptLink').value,
      carouselBriefings: $('#socialPostFormType').value === 'carrossel' ? socialCarouselBriefings : []
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

        // Fotinho de quem está envolvido no material (20ª rodada, pedido da
        // Raquel: "no calendário, cronograma, deve aparecer a fotinho da
        // pessoa"). Sem ninguém marcado como envolvido, mostra quem criou o
        // agendamento — pra sempre ter alguém identificável no chip.
        const involvedUsers = (p.involvedUserIds || []).length > 0
          ? (p.involvedUserIds || []).map((id) => teamMembers.find((m) => m.id === id)).filter(Boolean)
          : [{ name: p.createdByName, photoUrl: p.createdByPhotoUrl }];
        const MAX_AVATARS = 3;
        const shown = involvedUsers.slice(0, MAX_AVATARS);
        const extra = involvedUsers.length - shown.length;
        const stack = document.createElement('div');
        stack.className = 'avatar-stack';
        stack.innerHTML = shown.map((u) => avatarHtml(u, 18)).join('') + (extra > 0 ? `<span class="avatar-stack-more">+${extra}</span>` : '');
        chip.appendChild(stack);

        chip.onclick = () => openPostFromCronograma(p.id);
        cell.appendChild(chip);
      });

      grid.appendChild(cell);
    }
  }

  // Só gerente, coordenador(a) ou admin da plataforma podem marcar
  // aprovado/reprovado na Prévia do Feed — todo mundo enxerga o status.
  function canApprovePost() {
    return !!currentUser && (currentUser.isSuperAdmin || currentUser.cargo === 'gerente' || currentUser.cargo === 'coordenador');
  }

  async function setPostApproval(postId, approvalStatus, approvalNotes) {
    try {
      await api(`/api/social-posts/${postId}/approval`, { method: 'PUT', body: JSON.stringify({ approvalStatus, approvalNotes: approvalNotes || '' }) });
      const fresh = await api('/api/social-posts');
      socialPosts = fresh.posts;
      renderCronogramaFeed();
    } catch (e) {
      alert(e.message);
    }
  }

  // Quadradinho de aprovação — verde quando aprovado, vermelho quando
  // reprovado (e nesse caso abre um campo pra escrever as alterações
  // necessárias). Só quem pode aprovar consegue clicar; os demais só veem
  // o status.
  function renderApprovalWidget(p) {
    const editable = canApprovePost();
    const wrap = document.createElement('div');
    wrap.className = 'approval-widget';
    wrap.onclick = (ev) => ev.stopPropagation();

    const squares = document.createElement('div');
    squares.className = 'approval-squares';

    const sqOk = document.createElement('button');
    sqOk.type = 'button';
    sqOk.className = 'approval-square approval-ok' + (p.approvalStatus === 'aprovado' ? ' active' : '');
    sqOk.title = 'Aprovado';
    sqOk.textContent = '✓';
    sqOk.disabled = !editable;

    const sqNo = document.createElement('button');
    sqNo.type = 'button';
    sqNo.className = 'approval-square approval-no' + (p.approvalStatus === 'reprovado' ? ' active' : '');
    sqNo.title = 'Reprovado';
    sqNo.textContent = '✕';
    sqNo.disabled = !editable;

    squares.appendChild(sqOk);
    squares.appendChild(sqNo);
    wrap.appendChild(squares);

    const notesWrap = document.createElement('div');
    notesWrap.className = 'approval-notes';
    notesWrap.hidden = p.approvalStatus !== 'reprovado';
    if (editable) {
      const ta = document.createElement('textarea');
      ta.rows = 2;
      ta.placeholder = 'Alterações necessárias...';
      ta.value = p.approvalNotes || '';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-link';
      saveBtn.textContent = 'Salvar alterações';
      saveBtn.onclick = () => setPostApproval(p.id, 'reprovado', ta.value);
      notesWrap.appendChild(ta);
      notesWrap.appendChild(saveBtn);
    } else if (p.approvalNotes) {
      const readonly = document.createElement('div');
      readonly.className = 'approval-notes-readonly';
      readonly.textContent = p.approvalNotes;
      notesWrap.appendChild(readonly);
    }
    wrap.appendChild(notesWrap);

    sqOk.onclick = () => {
      if (!editable) return;
      const next = p.approvalStatus === 'aprovado' ? 'pendente' : 'aprovado';
      setPostApproval(p.id, next, '');
    };
    sqNo.onclick = () => {
      if (!editable) return;
      if (p.approvalStatus === 'reprovado') {
        setPostApproval(p.id, 'pendente', '');
      } else {
        notesWrap.hidden = false;
        setPostApproval(p.id, 'reprovado', p.approvalNotes || '');
      }
    };

    return wrap;
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

      const files = p.files || [];
      const file = files[0];
      const isVideo = !!file && /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name || file.url || '');
      // Carrossel com mais de uma imagem (22ª rodada, pedido da Raquel:
      // "quando o agendamento for carrossel, ele terá mais de um card...
      // deve ter a opção de clicar no post e ver os demais card, como se
      // fosse um carrossel no feed mesmo") — usa o mesmo array de
      // "Criativo final" já existente (já aceitava vários arquivos), só
      // mostrando um indicador "1/N" por cima da primeira imagem.
      const isCarousel = p.postType === 'carrossel' && files.length > 1;
      const carouselBadge = isCarousel ? `<span class="feed-preview-carousel-badge">🖼 1/${files.length}</span>` : '';
      const mediaHtml = file
        ? (isVideo ? `<video src="${file.url}" controls></video>` : `<img src="${file.url}" alt="">`) + carouselBadge
        : `<div class="feed-preview-noimg">Sem criativo anexado ainda</div>`;

      const accountLabel = SOCIAL_PLATFORM_LABEL[p.platform] || p.platform;
      // Foto de quem criou o agendamento (20ª rodada) — antes esse círculo
      // sempre mostrava a inicial de quem está OLHANDO a tela (currentUser),
      // não de quem criou o post; corrigido junto pra fazer sentido com a
      // foto de verdade agora disponível.
      const avatarPerson = { name: p.createdByName, photoUrl: p.createdByPhotoUrl };
      // Formato de cada rede (pedido da Raquel, 16ª rodada): Feed Insta em
      // 1080x1440, Feed LinkedIn em 1080x1350 — mostrado como referência
      // pra quem está montando o criativo, além de já bater com a
      // proporção do preview (ver .feed-preview-media no CSS).
      const formatLabel = isLinkedin ? 'Feed LinkedIn · formato 1080×1350' : `Feed ${accountLabel} · formato 1080×1440`;
      const header = `
        <div class="feed-preview-header">
          ${avatarHtml(avatarPerson, 32, 'feed-preview-avatar')}
          <div class="feed-preview-headtext">
            <span class="feed-preview-account">${p.createdByName || accountLabel}</span>
            <span class="feed-preview-meta">${fmtDate(p.scheduledDate)}${p.scheduledTime ? ' · ' + p.scheduledTime : ''} · ${SOCIAL_POST_TYPE_LABEL[p.postType] || ''}</span>
            <span class="feed-preview-format">${formatLabel}</span>
          </div>
        </div>`;
      // Pedido da Raquel (19ª rodada): quem criou o agendamento só aparece
      // em cima (cabeçalho do preview) — embaixo, igual é na rede social de
      // verdade, quem "assina" a legenda é a conta/marca, não a pessoa.
      const brandLabel = BRAND_LABEL[p.brand] || BRAND_LABEL.debacco;
      const captionHtml = `<div class="feed-preview-caption"><b>${brandLabel}</b> ${p.caption || '(sem legenda)'}</div>`;

      card.innerHTML = isLinkedin
        ? header + captionHtml + `<div class="feed-preview-media">${mediaHtml}</div>`
        : header + `<div class="feed-preview-media">${mediaHtml}</div><div class="feed-preview-actions">♡ ⤳ ✉</div>` + captionHtml;

      card.appendChild(renderApprovalWidget(p));

      // A imagem/vídeo tem um clique próprio (abre em tamanho de verdade,
      // sem o recorte/miniatura de 340px do card — resolve também o
      // pedido "as imagens estão aparecendo com baixa qualidade, ele deve
      // manter a qualidade das imagens": a Plataforma nunca recomprimiu
      // nada, ver 16ª rodada — só faltava um jeito de ver o arquivo
      // original em vez da miniatura recortada). stopPropagation pra não
      // também abrir o agendamento pra edição (clique no resto do card
      // continua abrindo a edição, como sempre).
      if (files.length > 0) {
        const mediaEl = card.querySelector('.feed-preview-media');
        mediaEl.style.cursor = 'zoom-in';
        mediaEl.onclick = (ev) => {
          ev.stopPropagation();
          openFeedLightbox(files, 0);
        };
      }

      card.onclick = () => openPostFromCronograma(p.id);
      list.appendChild(card);
    });
  }

  // ---------- Lightbox da Prévia do Feed (22ª rodada) ----------
  // Mostra o(s) arquivo(s) de um agendamento em tamanho de verdade
  // (object-fit:contain, sem cortar), com navegação entre os cards do
  // carrossel quando houver mais de um arquivo.
  function renderFeedLightboxMedia() {
    const file = feedLightboxFiles[feedLightboxIndex];
    const mediaWrap = $('#feedLightboxMedia');
    if (!file) { mediaWrap.innerHTML = ''; return; }
    const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name || file.url || '');
    mediaWrap.innerHTML = isVideo
      ? `<video src="${file.url}" controls autoplay class="feed-lightbox-img"></video>`
      : `<img src="${file.url}" alt="" class="feed-lightbox-img">`;
    const multi = feedLightboxFiles.length > 1;
    $('#feedLightboxPrev').hidden = !multi;
    $('#feedLightboxNext').hidden = !multi;
    $('#feedLightboxCounter').hidden = !multi;
    $('#feedLightboxCounter').textContent = multi ? `${feedLightboxIndex + 1} / ${feedLightboxFiles.length}` : '';
    const dots = $('#feedLightboxDots');
    dots.innerHTML = '';
    dots.hidden = !multi;
    if (multi) {
      feedLightboxFiles.forEach((f, i) => {
        const dot = document.createElement('span');
        dot.className = 'feed-lightbox-dot' + (i === feedLightboxIndex ? ' active' : '');
        dot.onclick = (ev) => { ev.stopPropagation(); feedLightboxIndex = i; renderFeedLightboxMedia(); };
        dots.appendChild(dot);
      });
    }
  }
  function openFeedLightbox(files, startIndex) {
    feedLightboxFiles = files || [];
    feedLightboxIndex = startIndex || 0;
    if (feedLightboxFiles.length === 0) return;
    renderFeedLightboxMedia();
    $('#feedLightbox').hidden = false;
  }
  function closeFeedLightbox() {
    $('#feedLightbox').hidden = true;
    $('#feedLightboxMedia').innerHTML = ''; // para vídeo em reprodução ao fechar
    feedLightboxFiles = [];
  }
  function feedLightboxStep(delta) {
    if (feedLightboxFiles.length === 0) return;
    feedLightboxIndex = (feedLightboxIndex + delta + feedLightboxFiles.length) % feedLightboxFiles.length;
    renderFeedLightboxMedia();
  }
  $('#feedLightboxClose').onclick = closeFeedLightbox;
  $('#feedLightbox').onclick = (e) => { if (e.target.id === 'feedLightbox') closeFeedLightbox(); };
  $('#feedLightboxPrev').onclick = (e) => { e.stopPropagation(); feedLightboxStep(-1); };
  $('#feedLightboxNext').onclick = (e) => { e.stopPropagation(); feedLightboxStep(1); };
  document.addEventListener('keydown', (e) => {
    if ($('#feedLightbox').hidden) return;
    if (e.key === 'Escape') closeFeedLightbox();
    if (e.key === 'ArrowLeft') feedLightboxStep(-1);
    if (e.key === 'ArrowRight') feedLightboxStep(1);
  });

  // ---------- Brindes ----------
  // Todo mundo pode ver o catálogo/registro de saídas — só quem tem
  // permissão "brindes" = editor/admin (ou é admin da plataforma) enxerga
  // os botões de criar/editar/excluir.
  function canEditBrindes() {
    if (!currentUser) return false;
    if (currentUser.isSuperAdmin) return true;
    const access = (currentUser.permissions || {}).brindes || 'none';
    return access === 'editor' || access === 'admin';
  }

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
    $('#brindesCatalogNewBtn').hidden = !canEditBrindes();
    $('#brindesLogNewBtn').hidden = !canEditBrindes();
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
    const editable = canEditBrindes();
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
      if (editable) {
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
      }
      body.appendChild(tr);
    });
  }

  function renderBrindesLog() {
    const body = $('#brindesLogBody');
    body.innerHTML = '';
    const editable = canEditBrindes();
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
      if (editable) {
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
      }
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
        <td>${avatarHtml(u, 30)}</td>
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
    return {
      trafegoPago: 'Tráfego Pago', acoesSazonais: 'Ações Sazonais', redesSociais: 'Redes Sociais', budget: 'Orçamento',
      brindes: 'Brindes (editar)', produtos: 'Produtos (editar)', expositores: 'Expositores (editar)'
    }[key] || key;
  }

  function openUserForm(user) {
    editingUserId = user ? user.id : null;
    pendingUserPhotoFile = null;
    $('#userFormPhotoInput').value = '';
    $('#userFormPhotoPreview').innerHTML = avatarHtml(user || null, 48);
    $('#userFormTitle').textContent = user ? 'Editar usuário' : 'Novo usuário';
    $('#userFormName').value = user ? user.name : '';
    $('#userFormUsername').value = user ? user.username : '';
    $('#userFormUsername').disabled = false;
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

  // Foto de perfil: editando um usuário que já existe, sobe na hora; num
  // cadastro novo (ainda sem id), guarda o arquivo e sobe assim que o
  // usuário for criado com sucesso (ver userFormSave).
  $('#userFormPhotoInput').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (editingUserId) {
      try {
        const fd = new FormData();
        fd.append('photo', file);
        const data = await api('/api/auth/users/' + editingUserId + '/photo', { method: 'POST', body: fd });
        $('#userFormPhotoPreview').innerHTML = avatarHtml(data.user, 48);
        await loadUsers();
        const team = await api('/api/auth/team');
        teamMembers = team.users;
      } catch (e) {
        $('#userFormError').textContent = e.message;
        $('#userFormError').hidden = false;
      }
    } else {
      pendingUserPhotoFile = file;
      $('#userFormPhotoPreview').innerHTML = `<img src="${URL.createObjectURL(file)}" class="avatar-img" style="width:48px;height:48px;" alt="">`;
    }
  };

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
        const created = await api('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) });
        // Foto escolhida antes de salvar (cadastro novo) — agora que o
        // usuário já tem id, sobe o arquivo guardado.
        if (pendingUserPhotoFile) {
          const fd = new FormData();
          fd.append('photo', pendingUserPhotoFile);
          await api('/api/auth/users/' + created.user.id + '/photo', { method: 'POST', body: fd }).catch(() => { /* usuário já foi criado; falha no upload não desfaz o cadastro */ });
          pendingUserPhotoFile = null;
        }
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

  // ---------- Gerenciamento de Influencers (14ª rodada) ----------
  $all('[data-inf-tab]').forEach((b) => {
    b.onclick = () => {
      influencersTab = b.dataset.infTab;
      $all('[data-inf-tab]').forEach((x) => x.classList.toggle('active', x.dataset.infTab === influencersTab));
      renderInfluencersList();
    };
  });

  async function loadInfluencers() {
    $('#influencerTableWrap').hidden = true;
    $('#influencerFormWrap').hidden = true;
    $('#influencerPostFormWrap').hidden = true;
    if (!influencerRedes.length) {
      try {
        const meta = await api('/api/influencers/meta');
        influencerRedes = meta.redes;
        $('#influencerPostFormRede').innerHTML = influencerRedes.map((r) => `<option value="${r}">${SOCIAL_PLATFORM_LABEL[r] || r}</option>`).join('');
      } catch (e) { /* ignora */ }
    }
    try {
      const data = await api('/api/influencers');
      influencersList = data.influencers;
      renderInfluencersList();
    } catch (e) {
      alert(e.message);
    }
  }

  function renderInfluencersList() {
    const wrap = $('#influencersList');
    wrap.innerHTML = '';
    const list = influencersList.filter((i) => i.brand === influencersTab);
    $('#influencersEmpty').hidden = list.length > 0;
    list.forEach((inf) => {
      const card = document.createElement('div');
      card.className = 'dash-card';
      card.innerHTML = `
        <h3>${inf.name}</h3>
        <p>${inf.hasPublicLink ? 'Link externo ativo' : 'Sem link externo ainda'}</p>
        <p class="muted" style="font-size:12px;margin-top:-4px;">${inf.contrato ? '📎 Contrato anexado' : 'Sem contrato ainda'}</p>
      `;
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Ver tabela →';
      openBtn.onclick = () => openInfluencerTable(inf);
      card.appendChild(openBtn);
      const actionsRow = document.createElement('div');
      actionsRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';
      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Editar';
      renameBtn.className = 'btn-link';
      renameBtn.onclick = (e) => { e.stopPropagation(); openInfluencerForm(inf); };
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'btn-link';
      delBtn.style.color = 'var(--danger)';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Excluir o influencer "${inf.name}" e toda a tabela dele? Essa ação não pode ser desfeita.`)) return;
        try {
          await api('/api/influencers/' + inf.id, { method: 'DELETE' });
          await loadInfluencers();
        } catch (err) { alert(err.message); }
      };
      actionsRow.appendChild(renameBtn);
      actionsRow.appendChild(delBtn);
      card.appendChild(actionsRow);
      wrap.appendChild(card);
    });
  }

  // Dados pessoais + contrato (21ª rodada) — mesmo formulário usado tanto
  // pra cadastrar quanto pra editar depois (era só "Renomear" antes; agora
  // dá pra completar/corrigir os dados a qualquer momento).
  function openInfluencerForm(inf) {
    editingInfluencerId = inf ? inf.id : null;
    $('#influencerFormTitle').textContent = inf ? 'Editar influencer' : 'Novo influencer';
    $('#influencerFormName').value = inf ? inf.name : '';
    $('#influencerFormCpf').value = inf ? (inf.cpf || '') : '';
    $('#influencerFormRg').value = inf ? (inf.rg || '') : '';
    $('#influencerFormTelefone').value = inf ? (inf.telefone || '') : '';
    $('#influencerFormEmail').value = inf ? (inf.email || '') : '';
    $('#influencerFormDataNascimento').value = inf ? (inf.dataNascimento || '') : '';
    $('#influencerFormEndereco').value = inf ? (inf.endereco || '') : '';
    $('#influencerFormContractInput').value = '';
    if (inf && inf.contrato) {
      $('#influencerFormContractCurrent').hidden = false;
      $('#influencerFormContractLink').textContent = inf.contrato.name;
      $('#influencerFormContractLink').href = inf.contrato.url;
    } else {
      $('#influencerFormContractCurrent').hidden = true;
    }
    $('#influencerFormError').hidden = true;
    $('#influencerTableWrap').hidden = true;
    $('#influencerFormWrap').hidden = false;
  }
  $('#influencerNewBtn').onclick = () => openInfluencerForm(null);
  $('#influencerFormCancel').onclick = () => { $('#influencerFormWrap').hidden = true; };
  $('#influencerFormContractRemove').onclick = async () => {
    if (!editingInfluencerId) return;
    if (!confirm('Remover o contrato anexado?')) return;
    try {
      await api('/api/influencers/' + editingInfluencerId + '/contract', { method: 'DELETE' });
      $('#influencerFormContractCurrent').hidden = true;
    } catch (e) { alert(e.message); }
  };
  $('#influencerFormSave').onclick = async () => {
    const name = $('#influencerFormName').value.trim();
    if (!name) { $('#influencerFormError').textContent = 'Informe o nome do influencer.'; $('#influencerFormError').hidden = false; return; }
    const personalPayload = {
      name,
      cpf: $('#influencerFormCpf').value.trim(),
      rg: $('#influencerFormRg').value.trim(),
      telefone: $('#influencerFormTelefone').value.trim(),
      email: $('#influencerFormEmail').value.trim(),
      dataNascimento: $('#influencerFormDataNascimento').value || '',
      endereco: $('#influencerFormEndereco').value.trim()
    };
    try {
      let infId = editingInfluencerId;
      if (infId) {
        await api('/api/influencers/' + infId, { method: 'PUT', body: JSON.stringify(personalPayload) });
      } else {
        const created = await api('/api/influencers', { method: 'POST', body: JSON.stringify(Object.assign({ brand: influencersTab }, personalPayload)) });
        infId = created.influencer.id;
      }
      const contractFile = $('#influencerFormContractInput').files[0];
      if (contractFile) {
        const fd = new FormData();
        fd.append('contract', contractFile);
        await api('/api/influencers/' + infId + '/contract', { method: 'POST', body: fd });
      }
      $('#influencerFormWrap').hidden = true;
      await loadInfluencers();
    } catch (e) {
      $('#influencerFormError').textContent = e.message;
      $('#influencerFormError').hidden = false;
    }
  };

  // ---------- tabela de um influencer ----------
  async function openInfluencerTable(inf) {
    $('#influencerFormWrap').hidden = true;
    $('#influencerPostFormWrap').hidden = true;
    $('#influencerPublicLinkPanel').hidden = true;
    try {
      const data = await api('/api/influencers/' + inf.id);
      currentInfluencer = data.influencer;
      currentInfluencerPosts = data.posts;
      $('#influencerTableTitle').textContent = currentInfluencer.name + ' — ' + (BRAND_LABEL[currentInfluencer.brand] || currentInfluencer.brand);
      renderInfluencerPosts();
      $('#influencerTableWrap').hidden = false;
    } catch (e) {
      alert(e.message);
    }
  }
  $('#influencerTableBackBtn').onclick = () => { $('#influencerTableWrap').hidden = true; loadInfluencers(); };

  function renderInfluencerPosts() {
    const body = $('#influencerPostsBody');
    body.innerHTML = '';
    $('#influencerPostsEmpty').hidden = currentInfluencerPosts.length > 0;
    currentInfluencerPosts.forEach((p) => {
      const tr = document.createElement('tr');
      if (p.rede && INFLUENCER_REDE_COLOR[p.rede]) {
        tr.style.background = `color-mix(in srgb, ${INFLUENCER_REDE_COLOR[p.rede]} 12%, white)`;
      }
      const parceriaLabel = p.tipoParceria === 'permuta' ? 'Permuta' : (p.tipoParceria === 'paga' ? 'Paga' : '—');
      const parceriaHtml = [
        parceriaLabel,
        p.tipoParceria === 'permuta' && p.dataSaida ? `<br><span class="muted" style="font-size:11px;">Saída: ${fmtDate(p.dataSaida)}</span>` : '',
        p.notaFiscal ? `<br><a href="${p.notaFiscal.url}" target="_blank" rel="noopener" style="font-size:11px;">📎 Nota fiscal</a>` : ''
      ].join('');
      tr.innerHTML = `
        <td>${p.formato || '—'}</td>
        <td>${SOCIAL_PLATFORM_LABEL[p.rede] || p.rede || '—'}</td>
        <td>${influencerStatusPillHTML(p.status, true, p.id)}</td>
        <td>${p.dataPostagem ? fmtDate(p.dataPostagem) : '—'}</td>
        <td>${p.arquivo ? `<a href="${p.arquivo.url}" target="_blank" rel="noopener">${p.arquivo.name}</a>` : '—'}</td>
        <td>${parceriaHtml}</td>
        <td>${p.observacoes || '—'}</td>
        <td>${p.notas || '—'}</td>
        <td></td>
      `;
      const statusSelect = tr.querySelector('[data-inf-status-select]');
      statusSelect.onclick = (e) => e.stopPropagation();
      statusSelect.onchange = async () => {
        const novoStatus = statusSelect.value;
        try {
          await api(`/api/influencers/${currentInfluencer.id}/posts/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: novoStatus }) });
          p.status = novoStatus;
          renderInfluencerPosts();
        } catch (e) {
          alert(e.message);
        }
      };
      const actionsTd = tr.querySelector('td:last-child');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.onclick = () => openInfluencerPostForm(p);
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Excluir';
      delBtn.className = 'danger';
      delBtn.onclick = async () => {
        if (!confirm('Excluir este item da tabela?')) return;
        try {
          await api(`/api/influencers/${currentInfluencer.id}/posts/${p.id}`, { method: 'DELETE' });
          await openInfluencerTable(currentInfluencer);
        } catch (e) { alert(e.message); }
      };
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(delBtn);
      body.appendChild(tr);
    });
  }

  function openInfluencerPostForm(post) {
    editingInfluencerPostId = post ? post.id : null;
    $('#influencerPostFormTitle').textContent = post ? 'Editar item' : 'Novo item';
    $('#influencerPostFormId').value = post ? post.id : '';
    $('#influencerPostFormFormato').value = post ? post.formato : '';
    $('#influencerPostFormRede').value = post ? (post.rede || influencerRedes[0]) : influencerRedes[0];
    $('#influencerPostFormStatus').value = post ? post.status : 'a_publicar';
    $('#influencerPostFormData').value = post ? (post.dataPostagem || '') : '';
    $('#influencerPostFormObs').value = post ? post.observacoes : '';
    $('#influencerPostFormNotas').value = post ? post.notas : '';
    $('#influencerPostFormFile').value = '';
    $('#influencerPostFormFileAtual').textContent = post && post.arquivo ? ('Arquivo atual: ' + post.arquivo.name) : '';
    // Parceria em permuta (22ª rodada) — data de saída só faz sentido
    // quando o tipo é "permuta", então o campo fica escondido nos outros
    // casos (ver onchange do select logo abaixo).
    $('#influencerPostFormParceria').value = post ? (post.tipoParceria || '') : '';
    $('#influencerPostFormDataSaida').value = post ? (post.dataSaida || '') : '';
    $('#influencerPostFormSaidaWrap').hidden = $('#influencerPostFormParceria').value !== 'permuta';
    $('#influencerPostFormNotaFiscal').value = '';
    $('#influencerPostFormNotaFiscalAtual').textContent = post && post.notaFiscal ? ('Nota fiscal atual: ' + post.notaFiscal.name) : '';
    $('#influencerPostFormError').hidden = true;
    $('#influencerPostFormWrap').hidden = false;
  }
  $('#influencerPostNewBtn').onclick = () => openInfluencerPostForm(null);
  $('#influencerPostFormCancel').onclick = () => { $('#influencerPostFormWrap').hidden = true; };
  $('#influencerPostFormParceria').onchange = () => {
    $('#influencerPostFormSaidaWrap').hidden = $('#influencerPostFormParceria').value !== 'permuta';
  };

  $('#influencerPostFormSave').onclick = async () => {
    const payload = {
      formato: $('#influencerPostFormFormato').value.trim(),
      rede: $('#influencerPostFormRede').value,
      status: $('#influencerPostFormStatus').value,
      dataPostagem: $('#influencerPostFormData').value || null,
      observacoes: $('#influencerPostFormObs').value.trim(),
      notas: $('#influencerPostFormNotas').value.trim(),
      tipoParceria: $('#influencerPostFormParceria').value || null,
      dataSaida: $('#influencerPostFormParceria').value === 'permuta' ? ($('#influencerPostFormDataSaida').value || null) : null
    };
    try {
      let postId = editingInfluencerPostId;
      if (postId) {
        await api(`/api/influencers/${currentInfluencer.id}/posts/${postId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const created = await api(`/api/influencers/${currentInfluencer.id}/posts`, { method: 'POST', body: JSON.stringify(payload) });
        postId = created.post.id;
      }
      const file = $('#influencerPostFormFile').files[0];
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/api/influencers/${currentInfluencer.id}/posts/${postId}/file`, { method: 'POST', body: fd });
      }
      const notaFiscalFile = $('#influencerPostFormNotaFiscal').files[0];
      if (notaFiscalFile) {
        const fd2 = new FormData();
        fd2.append('notaFiscal', notaFiscalFile);
        await api(`/api/influencers/${currentInfluencer.id}/posts/${postId}/nota-fiscal`, { method: 'POST', body: fd2 });
      }
      $('#influencerPostFormWrap').hidden = true;
      await openInfluencerTable(currentInfluencer);
    } catch (e) {
      $('#influencerPostFormError').textContent = e.message;
      $('#influencerPostFormError').hidden = false;
    }
  };

  // ---------- link externo do influencer ----------
  $('#influencerPublicLinkBtn').onclick = async () => {
    const panel = $('#influencerPublicLinkPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) await refreshInfluencerPublicLink();
  };
  async function refreshInfluencerPublicLink() {
    try {
      const data = await api('/api/influencers/' + currentInfluencer.id + '/public-link');
      setInfluencerPublicLinkUI(data.publicToken);
    } catch (e) { /* ignora */ }
  }
  function setInfluencerPublicLinkUI(pubToken) {
    const active = !!pubToken;
    $('#influencerPublicLinkActive').hidden = !active;
    $('#influencerGenLinkBtn').hidden = active;
    if (active) {
      $('#influencerPublicLinkField').value = `${window.location.origin}/?influencerPublic=${pubToken}`;
    }
  }
  $('#influencerGenLinkBtn').onclick = $('#influencerRegenLinkBtn').onclick = async () => {
    try {
      const data = await api(`/api/influencers/${currentInfluencer.id}/public-link/generate`, { method: 'POST' });
      setInfluencerPublicLinkUI(data.publicToken);
    } catch (e) { alert(e.message); }
  };
  $('#influencerRevokeLinkBtn').onclick = async () => {
    if (!confirm('Desativar o link externo? Quem tiver o link atual deixa de conseguir ver a tabela.')) return;
    try {
      await api(`/api/influencers/${currentInfluencer.id}/public-link`, { method: 'DELETE' });
      setInfluencerPublicLinkUI(null);
    } catch (e) { alert(e.message); }
  };
  $('#influencerCopyLinkBtn').onclick = () => {
    const field = $('#influencerPublicLinkField');
    field.select();
    navigator.clipboard && navigator.clipboard.writeText(field.value).catch(() => {});
  };

  // ---------- link externo por dashboard (28ª rodada) ----------
  // Mesmo padrão do link externo do influencer, só que 1 link por dashboard
  // inteiro (Mídias ou Tráfego) em vez de por item cadastrado — por isso os
  // ids/rotas usam a "chave" do dashboard (redesSociais/trafegoPago) em vez
  // de um id de registro.
  function setupDashboardPublicLink(dashKey, prefix) {
    $('#' + prefix + 'HubPublicLinkBtn').onclick = async () => {
      const panel = $('#' + prefix + 'PublicLinkPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await refresh();
    };
    async function refresh() {
      try {
        const data = await api('/api/dashboards/' + dashKey + '/public-link');
        setUI(data.publicToken);
      } catch (e) { /* ignora */ }
    }
    function setUI(pubToken) {
      const active = !!pubToken;
      $('#' + prefix + 'PublicLinkActive').hidden = !active;
      $('#' + prefix + 'GenLinkBtn').hidden = active;
      if (active) {
        $('#' + prefix + 'PublicLinkField').value = `${window.location.origin}/?dashboardPublic=${pubToken}`;
      }
    }
    $('#' + prefix + 'GenLinkBtn').onclick = $('#' + prefix + 'RegenLinkBtn').onclick = async () => {
      try {
        const data = await api('/api/dashboards/' + dashKey + '/public-link/generate', { method: 'POST' });
        setUI(data.publicToken);
      } catch (e) { alert(e.message); }
    };
    $('#' + prefix + 'RevokeLinkBtn').onclick = async () => {
      if (!confirm('Desativar o link externo? Quem tiver o link atual deixa de conseguir acessar.')) return;
      try {
        await api('/api/dashboards/' + dashKey + '/public-link', { method: 'DELETE' });
        setUI(null);
      } catch (e) { alert(e.message); }
    };
    $('#' + prefix + 'CopyLinkBtn').onclick = () => {
      const field = $('#' + prefix + 'PublicLinkField');
      field.select();
      navigator.clipboard && navigator.clipboard.writeText(field.value).catch(() => {});
    };
  }
  setupDashboardPublicLink('redesSociais', 'midias');
  setupDashboardPublicLink('trafegoPago', 'trafego');

  boot();
})();
