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
  // Responsável geral (30ª rodada, pedido da Raquel): marcação extra dentro
  // dos marcados na demanda, puramente visual/organizacional -- não conta
  // pontos a mais no REIS DO MARKETING, só ajuda a saber quem é o dono final
  // do card. Um só por vez (ou nenhum).
  let selectedResponsibleId = null;
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
  // 36ª rodada: mesmo padrão, agora pro chip-picker de "Pessoas envolvidas"
  // da ação de influencer (ver openInfluencerPostForm / renderInfluencerInvolvedChips).
  let influencerInvolvedIds = new Set();
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
  let influencersTab = 'debacco'; // 'debacco' | 'ghelplus' | 'todas'
  let influencersList = [];
  // "Todas as ações" (30ª rodada) -- lista agregada de todos os itens de
  // todos os influencers, com filtro por marca próprio (independente da
  // aba debacco/ghelplus, que é pra gerenciar influencer por influencer).
  let influencerAllPosts = [];
  let influencerAllBrandFilter = 'todos'; // 'todos' | 'debacco' | 'ghelplus'
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

  // Empilhado de fotinhos (até 3 + "+N") -- mesmo visual já usado no chip
  // do calendário do Cronograma (ver renderCronogramaCalendar), agora
  // reaproveitado pra mostrar "quem mais está no card" numa demanda vinda
  // de agendamento (36ª rodada, pedido da Raquel: "deve aparecer quem mais
  // esta no card, da mesma forma que fica... pela aba agendamento").
  function avatarStackHtml(people, size) {
    size = size || 18;
    const MAX = 3;
    const shown = people.slice(0, MAX);
    const extra = people.length - shown.length;
    return `<div class="avatar-stack">${shown.map((p) => avatarHtml(p, size)).join('')}${extra > 0 ? `<span class="avatar-stack-more">+${extra}</span>` : ''}</div>`;
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
  const SOCIAL_PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', newsletter: 'Newsletter', influencer: 'Influencer', blog: 'Blog' };
  // Ícones reais das redes (37ª rodada, pedido da Raquel: "use os icones
  // reais das redes sociais" no lugar dos emoji da 36ª rodada) -- SVG
  // inline pequeno e leve, um por rede, nas cores reais de cada marca.
  // Como isso é calculado na hora a partir de d.network/p.platform/p.rede
  // (nunca gravado no banco), a troca já vale sozinha pra tudo que já
  // existe na Plataforma -- não precisa de nenhuma migração de dados.
  const NETWORK_ICON_SVG = {
    instagram: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="2" y="2" width="20" height="20" rx="6" stroke="#E1306C" stroke-width="2.2"/><circle cx="12" cy="12" r="5" stroke="#E1306C" stroke-width="2.2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#E1306C"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path d="M15.2 12.5h-2.15V20h-3v-7.5H8.4V10h1.65V8.4c0-2 1-3.4 3.4-3.4h2.25v2.6h-1.45c-.85 0-1.15.4-1.15 1.2V10h2.55l-.45 2.5Z" fill="#fff"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0A66C2"/><circle cx="7.4" cy="7.8" r="1.7" fill="#fff"/><rect x="6.1" y="10.2" width="2.7" height="8.2" fill="#fff"/><path d="M11.4 10.2h2.6v1.25c.5-.85 1.45-1.45 2.75-1.45 2.05 0 3.35 1.35 3.35 4v4.95h-2.65v-4.5c0-1.25-.5-2.05-1.65-2.05s-1.85.8-1.85 2.05v4.5h-2.55V10.2Z" fill="#fff"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="1" y="1" width="22" height="22" rx="6" fill="#010101"/><path d="M16.3 5.3c.4 1.7 1.55 2.85 3.3 3v2.35c-1.15 0-2.2-.3-3.1-.9v4.9c0 2.55-1.95 4.55-4.4 4.55-2.45 0-4.4-2-4.4-4.55 0-2.5 1.95-4.5 4.4-4.5.3 0 .6.05.9.1v2.4c-.3-.1-.6-.15-.9-.15-1.1 0-2.05.9-2.05 2.15 0 1.25.95 2.15 2.05 2.15 1.15 0 2.15-.9 2.15-2.55V5.3h1.9Z" fill="#fff"/><path d="M16.3 5.3c.4 1.7 1.55 2.85 3.3 3v1.15c-1.35-.25-2.5-.95-3.3-1.9v-2.25Z" fill="#25F4EE"/><path d="M9.2 12.65c-2 .35-3.5 2.15-3.5 4.3 0 .5.08.95.23 1.4a4.55 4.55 0 0 1-.63-2.3c0-2.5 1.95-4.5 4.4-4.5.3 0 .6.05.9.1v.85c-.4-.1-.85-.1-1.4.15Z" fill="#FE2C55"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="1" y="4" width="22" height="16" rx="5" fill="#FF0000"/><path d="M10 8.4 16.6 12 10 15.6V8.4Z" fill="#fff"/></svg>',
    pinterest: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><circle cx="12" cy="12" r="11" fill="#BD081C"/><path d="M12.2 5.3c-3.8 0-5.8 2.6-5.8 4.8 0 1.3.5 2.5 1.6 2.9.18.07.34 0 .4-.2l.16-.6c.05-.2.03-.27-.12-.44-.34-.4-.55-.93-.55-1.66 0-2.14 1.6-4.06 4.18-4.06 2.28 0 3.53 1.4 3.53 3.26 0 2.45-1.09 4.53-2.7 4.53-.9 0-1.56-.73-1.35-1.63.26-1.08.75-2.24.75-3.02 0-.7-.37-1.28-1.15-1.28-.9 0-1.63.93-1.63 2.18 0 .8.27 1.33.27 1.33s-.9 3.8-1.07 4.5c-.24 1-.1 2.2-.04 2.75.02.15.2.19.28.06.13-.18 1.14-1.41 1.5-2.7.1-.4.6-2.3.6-2.3.3.57 1.16 1.06 2.08 1.06 2.75 0 4.7-2.5 4.7-5.84 0-2.9-2.35-5.05-5.66-5.05Z" fill="#fff"/></svg>',
    newsletter: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="2" y="5" width="20" height="14" rx="3" stroke="#6D63E0" stroke-width="2"/><path d="M3 7l9 6 9-6" stroke="#6D63E0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    influencer: '<svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z" fill="#F5A623"/></svg>',
    blog: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><rect x="4" y="2.5" width="14" height="19" rx="2" stroke="#0EA5A4" stroke-width="2"/><path d="M7.5 8h7M7.5 12h7M7.5 16h4" stroke="#0EA5A4" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };
  // Devolve o SVG da rede pronto pra usar num template, ou '' se não tiver
  // rede/ícone (evita `undefined` aparecendo no HTML).
  function networkIconHtml(network) {
    return NETWORK_ICON_SVG[network] || '';
  }
  // Ícones das marcas (37ª rodada, pedido da Raquel): fica no início do
  // título do card em Demandas. GhelPlus e Duranox usam só a letra da
  // logo (G/D estilizado) na cor certa, como pedido; De Bacco e Boutique
  // Inox usam o próprio símbolo da marca (não têm uma letra marcante),
  // também na cor certa.
  const BRAND_ICON_SVG = {
    // 39ª rodada, pedido da Raquel: De Bacco, GhelPlus e Duranox trocaram
    // pra imagem real da marca (arquivo enviado por ela), em vez do
    // desenho aproximado da 37ª rodada -- embutida como PNG base64 (mesmo
    // arquivo, só redimensionado/recortado com folga de qualidade) pra não
    // depender de nenhum arquivo externo. Boutique Inox continua com o
    // símbolo desenhado (confirmado correto pela Raquel, não mexido).
    ghelplus: '<img src="data:image/png;base64,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" width="15" height="15" style="vertical-align:-3px;border-radius:3px;object-fit:contain" alt="">',
    duranox: '<img src="data:image/png;base64,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" width="15" height="15" style="vertical-align:-3px;border-radius:3px;object-fit:cover" alt="">',
    debacco: '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAE/klEQVR4nO2dT4scRRiHn7e6Y2ISQRDBCEEN5BIhCoIiEQ/6AQTRg4GI4MHPoN/AYD6BHv2HioF4EHKKBxFFSTyoEDUYDDkIkhxi4k6m6vXQ3TvDumtwdjY7Ne/vgWbpmh2o6Xr6rZ7pqd9Y07SOqI0RcMXdL5jxNXA65/wFcL1/vAUycMuxNQmwLPh54MOc89vApb4xAeW/niUB6sWntgRY337VnROljI/TVYqGrhqsiwRYHkq/tQDu/l3TpFdv3rz5fd82Xu9JEmD5cLozvgWugb+ccz7JBhKk29w5sfUYk4vAvWCfppSO0Q1++69/VgVYaoYLwAT+XM75FGuuCSTA8lPoqsL1nNPjMPqRqXcHmgKWn2Gw96SU3wfuoBPChgfF8tMAYzN7JKX2dbopIIGmgEgMnxms5Dw+BFwETBUgDkY3FdzZNM0bdDKYKkAshrG+kfP4IHBZFSAWRjf/706pfQl0ERgRAxz8BTQFhGYl53RYFSAmBdiZkj8tAWLiAGb+pASIiQG4+8MSICYGYGb7JUBMhm8P3S0BYrNLAsRG9wKiIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCIwGCMyRJLCo2tYktoKVbOrzoDJLW0NeqaN05td2dWAcDdpv5/WAPAbv69iHtQhVhTiz6gTTgwZR2PAPlFTN7qm/PqBrMAzcW90A6a1Ium6Z5EewEsB9JMA+8hgpgTHJuCnBfSs3HfTWQBJtj4QVYyxB2uDel5oyZPUYnhd7OzkZ1AsBEggNN054F9qILw1nxGs+cMbADuODOW3Rn/yJ/lrHQ1HrWJLqLxHubpv0FuKvfr/X1bBdVVgCYfB7whztfTrWJ/0mtAkCfkW/m5/p9Rd3MQM0CALi7/bndnaiZ2gUAnfmbYhkEEJtAAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRHAgRnGQTQesBNULsAZub3bHcnaqZmAQrd0rBH+31Vghmo9aBpefh8qHZ5eAN4Su1rdIM/RoM/EzUetOmImHPAHhQRMyvVVYDpkKiP6M5+0ODPzKILMETEtf3fMbAvpebzPiEss/ivYaFRUGRsFj4mLsHOB1Iqz/ZRsUf6dg3+fHBLqf1su3uxAbvNfB/YAWBn36aw6Pni1jRtDREriovfGryWH4zQwG8RtfxghNgi9BYqOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgOBIgNtUtDBHz5W8JEJPhi8BXJUBMHMDdf5cAMXEAM/tBAsTEANztq1oWhoj5s5JzOqwKEI8MuLufhdHPEiAefZSOfUJFawPFfBjG+kbO44PAZVWAWGTAwN8DLgOtKkAcvN9Wch4fAi4CpgoQhwwkd94EfqO7D1RUAWKQgcbdz5WSn+j3C7oZFIJCd7b/VUpzFBgxmQ50O3jJGUK2DPwojH6iy4NYDd9qt6Vb4nawGqTlXo6VUk4xyVlcRRVg+XC6QW6Aa+DPl1LeZZ3BBwmwTBQmmcmtu3+bkh3JOZ9kg8EHTQE141NbmtquunOilHy8lDyiqwTrDj5IgJpZk5fo54EPcs7vAJf6xsQtUuAkQJ2MgCvu/qsZ3wCnc85ngBv940P8X9ng+av8A8mdXG5ISzLcAAAAAElFTkSuQmCC" width="15" height="15" style="vertical-align:-3px;border-radius:3px;object-fit:cover" alt="">',
    boutiqueinox: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px"><circle cx="7.6" cy="12" r="4.3" stroke="#010835" stroke-width="2.3"/><circle cx="14.6" cy="12" r="4.3" stroke="#010835" stroke-width="2.3"/></svg>'
  };
  function brandIconHtml(brand) {
    return BRAND_ICON_SVG[brand] ? `<span class="card-brand-icon" title="${BRAND_LABEL[brand] || brand}">${BRAND_ICON_SVG[brand]}</span>` : '';
  }
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

  // Cor da frase de boas-vindas (32ª rodada, pedido da Raquel: "deixe ela em
  // arial bold, mas colorida, a cor tbm deve mudar a cada login") — mesmo
  // mecanismo de sorteio/persistência da frase em si (sessionStorage, some
  // no logout pra sortear de novo no próximo login), só que guardando o
  // índice da cor em vez do índice da frase.
  const HOME_GREETING_COLORS = ['#6D63E0', '#E0537A', '#2F9E44', '#E8590C', '#1C7ED6', '#AE3EC9', '#F08C00', '#0CA678'];
  function pickHomeGreetingColor() {
    let idx = sessionStorage.getItem('homeGreetingColorIdx');
    if (idx === null || isNaN(Number(idx))) {
      idx = Math.floor(Math.random() * HOME_GREETING_COLORS.length);
      sessionStorage.setItem('homeGreetingColorIdx', String(idx));
    } else {
      idx = Number(idx);
    }
    return HOME_GREETING_COLORS[idx];
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
    // Produtos (33ª rodada) -- mesmo padrão do Budget acima.
    if (id === 'navProdutosConcorrencia' || id === 'navProdutosLancamentos') {
      $('#navProdutosParent').classList.add('active');
      $('#navProdutosSubmenu').hidden = false;
    }
    // Brindes (38ª rodada) -- mesmo padrão do Budget/Produtos acima.
    if (id === 'navBrindesControleGeral' || id === 'navBrindesRetiradas') {
      $('#navBrindesParent').classList.add('active');
      $('#navBrindesSubmenu').hidden = false;
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
          <td>${networkIconHtml(p.rede)} ${SOCIAL_PLATFORM_LABEL[p.rede] || p.rede || '—'}</td>
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
    startReisMarketingPolling();
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
    sessionStorage.removeItem('homeGreetingColorIdx'); // idem pra cor da frase
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
  $('#navProdutosParent').onclick = () => {
    const sub = $('#navProdutosSubmenu');
    sub.hidden = !sub.hidden;
  };
  $('#navBrindesParent').onclick = () => {
    const sub = $('#navBrindesSubmenu');
    sub.hidden = !sub.hidden;
  };
  $all('.navlink').forEach((b) => {
    if (b.id === 'navBudgetParent' || b.id === 'navProdutosParent' || b.id === 'navBrindesParent') return;
    b.onclick = () => {
      setActiveNav(b.id);
      // Gerenciamento de Mídias (26ª rodada): não abre mais o iframe cheio
      // do painel de Redes Sociais — abre a central nativa da Papoi
      // (view-midias-hub) primeiro; ver openMidiasHub().
      if (b.dataset.view === 'midias-hub') {
        openMidiasHub();
      } else if (b.dataset.view === 'trafego-hub') {
        openTrafegoHub();
      } else if (b.dataset.view === 'acoes-hub') {
        openAcoesSazonaisHub();
      } else if (b.dataset.view === 'expositores-hub') {
        openExpositoresHub();
      } else if (b.dataset.dash) {
        openDashboard(b.dataset.dash);
      } else if (b.dataset.view === 'budget') {
        openBudget(b.dataset.brand);
      } else if (b.dataset.view === 'produtos') {
        openProdutos(b.dataset.produtosTab);
      } else {
        showView(b.dataset.view);
        if (b.dataset.view === 'demandas') loadDemandas();
        if (b.dataset.view === 'users') loadUsers();
        if (b.dataset.view === 'brindes') loadBrindes();
        if (b.dataset.view === 'brindes-retiradas') loadRetiradas();
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
    $('#homeGreeting').style.color = pickHomeGreetingColor();
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

    await loadReisDoMarketing();

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

    // Produtos próximo do lançamento (33ª rodada) -- os 6 lançamentos mais
    // próximos (que ainda não foram marcados como "lançado"), sem data vai
    // pro fim da lista.
    try {
      const lanc = await api('/api/produtos/lancamentos');
      const wrap = $('#proximosLancamentosList');
      wrap.innerHTML = '';
      const proximos = (lanc.items || [])
        .filter((p) => p.status !== 'lancado')
        .sort((a, b) => {
          if (!a.dataLancamento && !b.dataLancamento) return 0;
          if (!a.dataLancamento) return 1;
          if (!b.dataLancamento) return -1;
          return a.dataLancamento.localeCompare(b.dataLancamento);
        })
        .slice(0, 6);
      $('#proximosLancamentosEmpty').hidden = proximos.length > 0;
      proximos.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'lowstock-row';
        const dataTxt = p.dataLancamento ? fmtDate(p.dataLancamento) : 'sem data';
        row.innerHTML = `<span class="lowstock-name">${p.nome}</span><span class="lowstock-qty">${dataTxt} (${BRAND_LABEL[p.brand] || p.brand})</span>`;
        wrap.appendChild(row);
      });
    } catch (e) { /* ignora falha pontual */ }
  }

  // ---------- REIS DO MARKETING (28ª rodada) ----------
  // Ranking de quem mais concluiu demandas no mês -- pedido da Raquel: uma
  // barra por colaborador (TODOS eles, não só quem concluiu algo), com a
  // foto de cada um subindo junto com a barra e uma coroa pro 1º lugar,
  // ordenado por quem mais concluiu no mês.
  async function loadReisDoMarketing() {
    try {
      const data = await api('/api/demandas/reis-do-marketing');
      renderReisDoMarketing(data.counts || {});
    } catch (e) { /* ignora falha pontual — a Início segue sem esse bloco */ }
  }

  function renderReisDoMarketing(counts) {
    const wrap = $('#reisMarketingChart');
    if (!wrap) return;
    // 31ª rodada, pedido da Raquel: quem tem cargo "Gerente" ou
    // "Coordenador(a)" nem aparece no gráfico — não é só zerar a pontuação,
    // a barra da pessoa some de vez (a regra de não pontuar já é garantida
    // pelo backend em /api/demandas/reis-do-marketing).
    const rows = (teamMembers || [])
      .filter((u) => u.cargo !== 'gerente' && u.cargo !== 'coordenador')
      .map((u) => ({
        id: u.id,
        fullName: u.name || u.username,
        firstName: (u.name || u.username || '').trim().split(/\s+/)[0] || u.username,
        photoUrl: u.photoUrl || null,
        count: counts[u.id] || 0
      }))
      .sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName));

    $('#reisMarketingEmpty').hidden = rows.length > 0;
    if (rows.length === 0) { wrap.innerHTML = ''; return; }

    const maxCount = Math.max(1, ...rows.map((r) => r.count));
    const BASE_BAR_H = 140; // px -- altura do 1º colocado; os outros são proporcionais
    // 33ª rodada, pedido da Raquel: em caso de empate na pontuação, todo
    // mundo empatado em 1º recebe a coroa -- não só quem aparece primeiro
    // na lista (o desempate por nome em .sort() acima é só pra ordem
    // visual, não decide quem é "o" campeão).
    const topCount = rows.length ? rows[0].count : 0;
    wrap.innerHTML = rows.map((r, idx) => {
      const barH = Math.max(10, Math.round(BASE_BAR_H * (r.count / maxCount)));
      const isChamp = r.count > 0 && r.count === topCount;
      const initials = (r.fullName || '?').trim().charAt(0).toUpperCase();
      const photoStyle = r.photoUrl ? `background-image:url('${r.photoUrl}');` : '';
      return `
        <div class="reis-bar-col" title="${r.fullName}: ${r.count} demanda${r.count === 1 ? '' : 's'} concluída${r.count === 1 ? '' : 's'} este mês">
          <div class="reis-bar-photo${r.photoUrl ? '' : ' reis-bar-photo-fallback'}" style="${photoStyle}">
            ${isChamp ? '<span class="reis-crown">👑</span>' : ''}
            ${r.photoUrl ? '' : initials}
          </div>
          <div class="reis-bar-value">${r.count}</div>
          <div class="reis-bar" style="height:${barH}px;${isChamp ? 'background:#F5A623;' : ''}"></div>
          <div class="reis-bar-name">${r.firstName}</div>
        </div>
      `;
    }).join('');
  }

  // 30ª rodada, pedido da Raquel: o gráfico precisa se atualizar sozinho
  // sempre que alguém concluir uma demanda (ou um item de checklist com
  // responsável), não só quando a página é recarregada. Dois mecanismos,
  // como já é feito pro Chat/recados/demandas nesse arquivo:
  // 1) chamada imediata logo depois da PRÓPRIA ação (marcar concluída,
  //    marcar item do checklist) -- pra quem fez a ação já ver o gráfico
  //    mudar na hora, sem esperar o polling;
  // 2) polling discreto enquanto a tela Início está aberta -- pra pegar
  //    conclusões feitas por OUTRAS pessoas em outra sessão.
  let reisMarketingPollTimer = null;
  function startReisMarketingPolling() {
    if (reisMarketingPollTimer) clearInterval(reisMarketingPollTimer);
    reisMarketingPollTimer = setInterval(() => {
      if (activeViewName === 'home') loadReisDoMarketing();
    }, 15000);
  }
  function refreshReisDoMarketingSoon() {
    loadReisDoMarketing().catch(() => { /* ignora falha pontual */ });
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
  $('#homeGoBrindes').onclick = () => { $('#navBrindesControleGeral').click(); };
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
      $('#midiasCanalFrame').style.height = '';
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
      $('#trafegoTelaFrame').style.height = '';
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

  // ---------- Ações Sazonais + Expositores Especiais (30ª rodada) ----------
  // Mesmo tratamento de hub nativo dado a Mídias/Tráfego: uma central com
  // um card por seção do painel de Ações Sazonais (dashboard-acoes-
  // sazonais), abrindo o conteúdo daquela seção num iframe só, com a
  // barra lateral do painel original escondida (ver .embedded-in-platform
  // no index.html dele) e as cores/tipografia já ajustadas pra igualar à
  // Papoi.
  //
  // Pedido da Raquel: os Expositores Especiais (Dashboard + cadastro)
  // SAEM do hub de Ações Sazonais e viram um item de menu PRÓPRIO — mesmo
  // painel de origem (mesma chave de dashboard, mesmo SSO), só que os
  // cards do hub mostram só essas 2 seções em vez das outras. Por isso os
  // dois hubs abaixo reaproveitam o mesmo dashboardLaunch('acoesSazonais')
  // e a mesma lista de marcas, mas com listas de seção diferentes.
  const ACOES_BRANDS = [
    { id: 'ghelplus', label: 'GhelPlus' },
    { id: 'debacco', label: 'De Bacco' },
    { id: 'all', label: 'Todas as marcas' }
  ];
  const ACOES_SECTIONS = [
    { id: 'dashboard', label: 'Dashboard Ações', desc: 'Visão geral das ações sazonais e resultados.' },
    { id: 'acoes', label: 'Ações', desc: 'Cadastro, edição e relatórios de cada ação.' },
    { id: 'historico', label: 'Histórico', desc: 'Quem criou, editou ou removeu cada registro.' },
    { id: 'usuarios', label: 'Usuários', desc: 'Contas com acesso ao painel de Ações Sazonais.', adminOnly: true },
    { id: 'link_publico', label: 'Link Público (do painel)', desc: 'Link de leitura própio do painel de Ações Sazonais, com estatísticas de acesso.', adminOnly: true }
  ];
  const EXPOSITORES_SECTIONS = [
    { id: 'dashboard_showroom', label: 'Dashboard Expositores Especiais', desc: 'Visão geral dos expositores especiais e investimentos.' },
    { id: 'showroom', label: 'Expositores Especiais', desc: 'Cadastro e acompanhamento de expositores especiais.' }
  ];
  let acoesBrand = 'ghelplus';
  let expositoresBrand = 'ghelplus';

  // Só mostra Usuários/Link Público do painel pra quem tem acesso admin
  // NESSE dashboard (mesmo controle de acesso já usado pros outros 2
  // dashboards) -- editor/visitante não vê esses cards no hub.
  function acoesSazonaisAccess() {
    return (dashboardsByKey.acoesSazonais || {}).access || 'none';
  }

  function openAcoesSazonaisHub() {
    showView('acoes-hub');
    $('#acoesHubPublicLinkBtn').hidden = !!dashboardPublicToken;
    if (dashboardPublicToken) $('#acoesPublicLinkPanel').hidden = true;
    renderAcoesBrandSwitch();
    renderAcoesHubBody();
  }

  function renderAcoesBrandSwitch() {
    const wrap = $('#acoesBrandSwitch');
    wrap.innerHTML = ACOES_BRANDS.map((b) => `<button class="btn-secondary${b.id === acoesBrand ? ' active' : ''}" data-acoes-brand="${b.id}">${b.label}</button>`).join('');
    wrap.querySelectorAll('[data-acoes-brand]').forEach((btn) => {
      btn.onclick = () => { acoesBrand = btn.dataset.acoesBrand; renderAcoesBrandSwitch(); };
    });
  }

  function renderAcoesHubBody() {
    const access = acoesSazonaisAccess();
    const sections = ACOES_SECTIONS.filter((s) => !s.adminOnly || access === 'admin');
    $('#acoesHubGroups').innerHTML = `
      <div class="card-grid">
        ${sections.map((s) => `
          <div class="dash-card" data-open-acoes-section="${s.id}">
            <h3>${s.label}</h3>
            <p>${s.desc}</p>
            <button>Abrir →</button>
          </div>`).join('')}
      </div>`;
    $all('[data-open-acoes-section]').forEach((card) => {
      card.querySelector('button').onclick = () => openAcoesSection(card.dataset.openAcoesSection);
    });
  }

  async function openAcoesSection(sectionId) {
    try {
      const data = await dashboardLaunch('acoesSazonais');
      const url = new URL(data.url);
      const baseUrl = url.origin;
      const platformParams = url.search;
      const params = new URLSearchParams();
      params.set('embedBrand', acoesBrand);
      params.set('embedView', sectionId);
      const navSrc = baseUrl.replace(/\/$/, '') + '/?' + params.toString();
      $('#acoesTelaFrame').style.height = '';
      $('#acoesTelaFrame').src = navSrc + '&' + platformParams.slice(1);
      const section = ACOES_SECTIONS.find((s) => s.id === sectionId) || {};
      const brandLabel = (ACOES_BRANDS.find((b) => b.id === acoesBrand) || {}).label || acoesBrand;
      $('#acoesTelaTitle').textContent = `${section.label || ''} — ${brandLabel}`;
      showView('acoes-tela');
    } catch (e) {
      alert(e.message);
    }
  }
  $('#acoesTelaBack').onclick = () => openAcoesSazonaisHub();

  function openExpositoresHub() {
    showView('expositores-hub');
    renderExpositoresBrandSwitch();
    renderExpositoresHubBody();
  }

  function renderExpositoresBrandSwitch() {
    const wrap = $('#expositoresBrandSwitch');
    wrap.innerHTML = ACOES_BRANDS.map((b) => `<button class="btn-secondary${b.id === expositoresBrand ? ' active' : ''}" data-expositores-brand="${b.id}">${b.label}</button>`).join('');
    wrap.querySelectorAll('[data-expositores-brand]').forEach((btn) => {
      btn.onclick = () => { expositoresBrand = btn.dataset.expositoresBrand; renderExpositoresBrandSwitch(); };
    });
  }

  function renderExpositoresHubBody() {
    $('#expositoresHubGroups').innerHTML = `
      <div class="card-grid">
        ${EXPOSITORES_SECTIONS.map((s) => `
          <div class="dash-card" data-open-expositores-section="${s.id}">
            <h3>${s.label}</h3>
            <p>${s.desc}</p>
            <button>Abrir →</button>
          </div>`).join('')}
      </div>`;
    $all('[data-open-expositores-section]').forEach((card) => {
      card.querySelector('button').onclick = () => openExpositoresSection(card.dataset.openExpositoresSection);
    });
  }

  async function openExpositoresSection(sectionId) {
    try {
      const data = await dashboardLaunch('acoesSazonais');
      const url = new URL(data.url);
      const baseUrl = url.origin;
      const platformParams = url.search;
      const params = new URLSearchParams();
      params.set('embedBrand', expositoresBrand);
      params.set('embedView', sectionId);
      const navSrc = baseUrl.replace(/\/$/, '') + '/?' + params.toString();
      $('#expositoresTelaFrame').style.height = '';
      $('#expositoresTelaFrame').src = navSrc + '&' + platformParams.slice(1);
      const section = EXPOSITORES_SECTIONS.find((s) => s.id === sectionId) || {};
      const brandLabel = (ACOES_BRANDS.find((b) => b.id === expositoresBrand) || {}).label || expositoresBrand;
      $('#expositoresTelaTitle').textContent = `${section.label || ''} — ${brandLabel}`;
      showView('expositores-tela');
    } catch (e) {
      alert(e.message);
    }
  }
  $('#expositoresTelaBack').onclick = () => openExpositoresHub();

  // Recebe a altura real do conteúdo embutido (Mídias/Tráfego/Ações
  // Sazonais/Expositores Especiais, 28ª/30ª rodada) e ajusta o iframe pra
  // caber tudo, sem scroll interno próprio -- quem rola a página é só o
  // scroll normal da Papoi (ver .iframe-wrap no style.css). Os painéis de
  // destino mandam essa mensagem sozinhos, sempre que a altura do
  // conteúdo deles muda.
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'papoi-embed-height') return;
    const h = Math.max(300, Math.ceil(data.height));
    if ($('#midiasCanalFrame') && event.source === $('#midiasCanalFrame').contentWindow) {
      $('#midiasCanalFrame').style.height = h + 'px';
    } else if ($('#trafegoTelaFrame') && event.source === $('#trafegoTelaFrame').contentWindow) {
      $('#trafegoTelaFrame').style.height = h + 'px';
    } else if ($('#acoesTelaFrame') && event.source === $('#acoesTelaFrame').contentWindow) {
      $('#acoesTelaFrame').style.height = h + 'px';
    } else if ($('#expositoresTelaFrame') && event.source === $('#expositoresTelaFrame').contentWindow) {
      $('#expositoresTelaFrame').style.height = h + 'px';
    }
  });

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
      refreshReisDoMarketingSoon();
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
            <div class="kanban-card-title">${brandIconHtml(d.brand)}${d.title}</div>
          </div>
          ${d.network ? `<div class="kanban-card-network">${networkIconHtml(d.network)} ${SOCIAL_PLATFORM_LABEL[d.network] || d.network}</div>` : ''}
          <div class="kanban-card-meta">
            <span class="badge">${statusLabel(d.status)}</span>
            ${d.dueDate ? `<span class="badge ${d.overdue ? 'badge-danger' : ''}">${fmtDate(d.dueDate)}</span>` : ''}
            ${d.recurring ? '<span class="badge badge-muted" title="Repete todo mês">↻ mensal</span>' : ''}
            ${(d.assigneeIds || []).length > 1 ? `<span class="badge">${d.assigneeIds.length} pessoas</span>` : ''}
            ${total > 0 ? `<span class="badge">✓ ${doneCount}/${total}</span>` : ''}
            ${(d.files || []).length > 0 ? `<span class="badge">📎 ${d.files.length}</span>` : ''}
            ${d.link ? '<span class="badge" title="Tem link">🔗</span>' : ''}
          </div>
          ${(d.alsoInvolvedPeople || []).length > 0 ? `<div class="kanban-card-also-involved" title="Também marcado(a) no mesmo agendamento: ${(d.alsoInvolvedNames || []).join(', ')}">${avatarStackHtml(d.alsoInvolvedPeople, 18)}</div>` : ''}
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

  // Select de responsável de um item do checklist (30ª rodada, pedido da
  // Raquel: "isso deve contabilizar para quem esta marcado no check list")
  // -- opcional; quem for marcado aqui passa a pontuar no REIS DO MARKETING
  // quando o item for concluído (ver regra em routes/demandas.js).
  function checklistAssigneeOptionsHTML(selectedId) {
    const opts = ['<option value="">Sem responsável</option>'].concat(
      teamMembers.map((u) => `<option value="${u.id}"${selectedId === u.id ? ' selected' : ''}>${u.name}</option>`)
    );
    return opts.join('');
  }

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
      row.innerHTML = `
        <label class="checklist-item-main">
          <input type="checkbox" ${item.done ? 'checked' : ''}>
          <span class="checklist-item-text">${item.text}</span>
        </label>
        <input type="date" class="checklist-due-input" title="Data de entrega deste item (opcional)" value="${item.dueDate || ''}">
        <select class="checklist-assignee-select">${checklistAssigneeOptionsHTML(item.assigneeId || null)}</select>
      `;
      row.querySelector('input[type="checkbox"]').onchange = async (ev) => {
        if (isDraft) {
          item.done = ev.target.checked;
          return;
        }
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ done: ev.target.checked }) });
        editingDemandaId = demanda.id;
        await refreshOpenDemanda();
        refreshReisDoMarketingSoon();
      };
      // Data de entrega individual do item (31ª rodada, pedido da Raquel:
      // "adicione a função de por a data de entrega de cada um dos itens de
      // check liste, de forma individual") — independente da data de
      // entrega do card, cada item guarda a própria data (opcional).
      row.querySelector('.checklist-due-input').onchange = async (ev) => {
        const dueDate = ev.target.value || null;
        if (isDraft) {
          item.dueDate = dueDate;
          return;
        }
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ dueDate }) });
        editingDemandaId = demanda.id;
        await refreshOpenDemanda();
      };
      row.querySelector('.checklist-assignee-select').onchange = async (ev) => {
        const assigneeId = ev.target.value || null;
        if (isDraft) {
          item.assigneeId = assigneeId;
          return;
        }
        await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ assigneeId }) });
        editingDemandaId = demanda.id;
        await refreshOpenDemanda();
      };
      // Editar o texto do item (31ª rodada, pedido da Raquel: "a opção de
      // editar o item do check list") — troca o texto por um campo editável
      // na hora, sem precisar apagar e recriar o item.
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '✎';
      editBtn.className = 'btn-link';
      editBtn.title = 'Editar item';
      editBtn.onclick = () => {
        const span = row.querySelector('.checklist-item-text');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'checklist-edit-input';
        input.value = item.text;
        span.replaceWith(input);
        input.focus();
        input.select();
        const commitEdit = async () => {
          const newText = input.value.trim();
          if (!newText || newText === item.text) {
            renderChecklist(demanda);
            return;
          }
          if (isDraft) {
            item.text = newText;
            renderChecklist(demanda);
            return;
          }
          await api(`/api/demandas/${demanda.id}/checklist/${item.id}`, { method: 'PUT', body: JSON.stringify({ text: newText }) });
          editingDemandaId = demanda.id;
          await refreshOpenDemanda();
        };
        input.onblur = commitEdit;
        input.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            input.blur();
          } else if (ev.key === 'Escape') {
            input.onblur = null;
            renderChecklist(demanda);
          }
        };
      };
      row.appendChild(editBtn);
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
        refreshReisDoMarketingSoon();
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
      // Responsável geral (30ª rodada, pedido da Raquel): marcação extra
      // dentro dos já marcados na demanda -- os demais continuam
      // aparecendo no card, mas não como responsáveis finais. É só
      // organizacional: não muda em nada a pontuação do REIS DO MARKETING
      // (todo mundo marcado continua pontuando igual).
      const respBtn = document.createElement('button');
      respBtn.type = 'button';
      respBtn.className = 'chip-responsible-btn' + (selectedResponsibleId === u.id ? ' active' : '');
      respBtn.title = selectedResponsibleId === u.id ? 'Responsável geral — clique para remover' : 'Marcar como responsável geral';
      respBtn.textContent = selectedResponsibleId === u.id ? '★' : '☆';
      respBtn.hidden = !selectedAssigneeIds.has(u.id);
      respBtn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectedResponsibleId = selectedResponsibleId === u.id ? null : u.id;
        renderAssigneeChips();
      };
      chip.appendChild(respBtn);
      chip.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) {
          selectedAssigneeIds.add(u.id);
        } else {
          selectedAssigneeIds.delete(u.id);
          if (selectedResponsibleId === u.id) selectedResponsibleId = null;
        }
        renderAssigneeChips();
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
    selectedResponsibleId = demanda ? (demanda.responsibleId || null) : null;
    selectedLabelIds = new Set(demanda ? (demanda.labelIds || []) : []);
    selectedDemColor = demanda ? (demanda.color || null) : null;
    $('#demCardTitle').value = demanda ? demanda.title : '';
    $('#demCardStatus').value = demanda ? demanda.status : 'a_fazer';
    $('#demCardDueDate').value = demanda ? (demanda.dueDate || '') : '';
    // Marca (37ª rodada, pedido da Raquel): opcional -- mostra o ícone da
    // marca no início do título do card. Demanda vinda de Agendamento/
    // Influencer já chega com isso preenchido sozinho; quem cria direto
    // aqui pode escolher.
    $('#demCardBrand').value = demanda ? (demanda.brand || '') : '';
    // Rede (38ª rodada, pedido da Raquel): opcional -- mostra o ícone da
    // rede no card, igual à Marca acima. Demanda vinda de Agendamento/
    // Influencer já chega com isso preenchido sozinho; quem cria direto
    // aqui também pode escolher, pra demanda de post/rede social criada
    // manualmente.
    $('#demCardNetwork').value = demanda ? (demanda.network || '') : '';
    $('#demCardRecurring').checked = demanda ? !!demanda.recurring : false;
    $('#demCardRecurringHint').hidden = !$('#demCardRecurring').checked;
    $('#demCardDescription').value = demanda ? (demanda.description || '') : '';
    $('#demCardLink').value = demanda ? (demanda.link || '') : '';
    $('#demChecklistTitle').value = demanda ? (demanda.checklistTitle || 'Checklist') : 'Checklist';
    $('#demCardError').hidden = true;
    $('#demChecklistInput').value = '';
    $('#demChecklistAssignee').innerHTML = checklistAssigneeOptionsHTML(null);
    $('#demFileInput').value = '';
    renderAssigneeChips();
    // Também marcado(a) no mesmo agendamento (34ª rodada) — só aparece em
    // cards que a Plataforma criou automaticamente a partir de um
    // agendamento de redes sociais com mais de 1 pessoa envolvida.
    const alsoInvolved = demanda ? (demanda.alsoInvolvedNames || []) : [];
    const alsoInvolvedPeople = demanda ? (demanda.alsoInvolvedPeople || []) : [];
    $('#demAlsoInvolvedNote').textContent = alsoInvolved.length > 0
      ? `Também marcado(a) no mesmo agendamento: ${alsoInvolved.join(', ')}. Concluir esta demanda conclui a de todos eles também.`
      : '';
    $('#demAlsoInvolvedNote').hidden = alsoInvolved.length === 0;
    // Fotinhos (36ª rodada) -- mesmo visual do Agendamento, além do texto
    // acima (que continua existindo pra quem prefere ler os nomes).
    $('#demAlsoInvolvedStack').innerHTML = alsoInvolvedPeople.length > 0 ? avatarStackHtml(alsoInvolvedPeople, 22) : '';
    $('#demAlsoInvolvedStack').hidden = alsoInvolvedPeople.length === 0;
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
      responsibleId: selectedResponsibleId,
      labelIds: Array.from(selectedLabelIds),
      color: selectedDemColor,
      link: $('#demCardLink').value.trim() || null,
      checklistTitle: $('#demChecklistTitle').value.trim() || 'Checklist',
      brand: $('#demCardBrand').value || null,
      network: $('#demCardNetwork').value || null,
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
      refreshReisDoMarketingSoon();
    } catch (e) {
      $('#demCardError').textContent = e.message;
      $('#demCardError').hidden = false;
    }
  };

  $('#demChecklistAdd').onclick = async () => {
    const text = $('#demChecklistInput').value.trim();
    if (!text) return;
    const assigneeId = $('#demChecklistAssignee').value || null;
    if (!editingDemandaId) {
      // Card ainda não salvo: guarda no rascunho local (26ª rodada) — vai
      // junto no payload quando o card for salvo pela primeira vez.
      draftChecklist.push({ text, done: false, assigneeId });
      $('#demChecklistInput').value = '';
      $('#demChecklistAssignee').value = '';
      renderChecklist({ checklist: draftChecklist });
      return;
    }
    await api(`/api/demandas/${editingDemandaId}/checklist`, { method: 'POST', body: JSON.stringify({ text, assigneeId }) });
    $('#demChecklistInput').value = '';
    $('#demChecklistAssignee').value = '';
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
    // 32ª rodada: arquivar/desarquivar muda se a demanda entra ou não na
    // conta do REIS DO MARKETING (demanda arquivada não pontua) -- atualiza
    // o gráfico junto, mesmo padrão já usado nas outras ações que mexem na
    // pontuação.
    refreshReisDoMarketingSoon();
  };

  $('#demCardDelete').onclick = async () => {
    if (!editingDemandaId) return;
    if (!confirm('Excluir esta demanda definitivamente? Essa ação não pode ser desfeita.')) return;
    await api('/api/demandas/' + editingDemandaId, { method: 'DELETE' });
    $('#demandaModal').hidden = true;
    await loadDemandas();
    refreshReisDoMarketingSoon();
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
        <td>${networkIconHtml(p.platform)} ${SOCIAL_PLATFORM_LABEL[p.platform] || p.platform}</td>
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

  // 36ª rodada: chip-picker de "Pessoas envolvidas" na ação de influencer
  // -- mesmo comportamento de renderInvolvedChips (Agendamento), só que
  // aponta pro wrap e pro Set da ação de influencer.
  function renderInfluencerInvolvedChips() {
    const wrap = $('#influencerPostFormInvolvedList');
    wrap.innerHTML = '';
    if (teamMembers.length === 0) {
      wrap.innerHTML = '<span class="chip-empty">Nenhum usuário cadastrado ainda.</span>';
      return;
    }
    teamMembers.forEach((u) => {
      const chip = document.createElement('label');
      chip.className = 'chip-toggle' + (influencerInvolvedIds.has(u.id) ? ' active' : '');
      const cargoTag = u.cargo ? ` (${CARGO_LABEL[u.cargo] || u.cargo})` : '';
      chip.innerHTML = `<input type="checkbox" ${influencerInvolvedIds.has(u.id) ? 'checked' : ''}> ${u.name}${cargoTag}`;
      chip.querySelector('input').onchange = (ev) => {
        if (ev.target.checked) influencerInvolvedIds.add(u.id); else influencerInvolvedIds.delete(u.id);
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
      // "past" (36ª rodada, pedido da Raquel: "os dias que já passaram
      // devem ficar em verde, pra mostrar que já passou aquela etapa do
      // cronograma") -- comparação de string funciona direto porque as
      // datas estão sempre no formato YYYY-MM-DD.
      cell.className = 'cal-day' + (otherMonth ? ' other-month' : '') + (dateStr === todayStr ? ' today' : '') + (dateStr < todayStr ? ' past' : '');
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
        chip.innerHTML = `<b>${networkIconHtml(p.platform)} ${p.scheduledTime || '--:--'} · ${SOCIAL_PLATFORM_LABEL[p.platform] || p.platform}</b>${SOCIAL_POST_TYPE_LABEL[p.postType] || ''}`;

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
            <span class="feed-preview-format">${networkIconHtml(p.platform)} ${formatLabel}</span>
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

  // 35ª rodada, pedido da Raquel: "todo lançamento, em brindes e
  // produtos, seja no formato que esta em budget fica mais facil
  // preencher assim, aquele poop up flutuante esta ruim, dificil de
  // entender" -- troca a cadeia de prompt() por um card inline (mesmo
  // .form-card/.form-row/.form-actions do Budget).
  function openBrindeForm(item, brand) {
    editingBrindeId = item ? item.id : null;
    $('#brindeFormTitle').textContent = item ? 'Editar item' : 'Novo item';
    $('#brindeFormBrand').value = brand;
    $('#brindeFormCode').value = item ? (item.code || '') : '';
    $('#brindeFormItem').value = item ? item.item : '';
    $('#brindeFormMultiplo').value = item ? (item.multiplo || '') : '1';
    $('#brindeFormValor').value = item && item.valor !== null && item.valor !== undefined ? item.valor : '';
    $('#brindeFormEstoquePR').value = item ? item.estoquePR : '0';
    $('#brindeFormEstoqueSP').value = item ? item.estoqueSP : '0';
    $('#brindeFormEstoquePE').value = item ? item.estoquePE : '0';
    $('#brindeFormStatus').value = item ? (item.status || '') : '';
    $('#brindeFormError').hidden = true;
    $('#brindeFormWrap').hidden = false;
  }
  $('#brindesCatalogNewBtn').onclick = () => openBrindeForm(null, brindesTab === 'log' ? 'debacco' : brindesTab);
  $('#brindeFormCancel').onclick = () => { $('#brindeFormWrap').hidden = true; };
  $('#brindeFormSave').onclick = async () => {
    const payload = {
      brand: $('#brindeFormBrand').value,
      code: $('#brindeFormCode').value.trim(),
      item: $('#brindeFormItem').value.trim(),
      multiplo: $('#brindeFormMultiplo').value.trim(),
      valor: $('#brindeFormValor').value,
      estoquePR: $('#brindeFormEstoquePR').value,
      estoqueSP: $('#brindeFormEstoqueSP').value,
      estoquePE: $('#brindeFormEstoquePE').value,
      status: $('#brindeFormStatus').value.trim()
    };
    if (!payload.item) {
      $('#brindeFormError').textContent = 'Informe o nome do item.';
      $('#brindeFormError').hidden = false;
      return;
    }
    try {
      if (editingBrindeId) {
        await api('/api/brindes/catalog/' + editingBrindeId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/brindes/catalog', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#brindeFormWrap').hidden = true;
      await loadBrindes();
    } catch (e) {
      $('#brindeFormError').textContent = e.message;
      $('#brindeFormError').hidden = false;
    }
  };

  function openBrindeLogForm() {
    $('#brindeLogFormBrand').value = 'debacco';
    $('#brindeLogFormDate').value = new Date().toISOString().slice(0, 10);
    $('#brindeLogFormRepresentante').value = '';
    $('#brindeLogFormEstado').value = '';
    $('#brindeLogFormCliente').value = '';
    $('#brindeLogFormQuantidade').value = '1';
    $('#brindeLogFormItem').value = '';
    $('#brindeLogFormMotivo').value = '';
    $('#brindeLogFormError').hidden = true;
    $('#brindeLogFormWrap').hidden = false;
  }
  $('#brindesLogNewBtn').onclick = openBrindeLogForm;
  $('#brindeLogFormCancel').onclick = () => { $('#brindeLogFormWrap').hidden = true; };
  $('#brindeLogFormSave').onclick = async () => {
    const payload = {
      brand: $('#brindeLogFormBrand').value,
      date: $('#brindeLogFormDate').value,
      representante: $('#brindeLogFormRepresentante').value.trim(),
      estado: $('#brindeLogFormEstado').value.trim(),
      cliente: $('#brindeLogFormCliente').value.trim(),
      quantidade: $('#brindeLogFormQuantidade').value,
      item: $('#brindeLogFormItem').value.trim(),
      motivo: $('#brindeLogFormMotivo').value.trim()
    };
    if (!payload.item) {
      $('#brindeLogFormError').textContent = 'Informe o item.';
      $('#brindeLogFormError').hidden = false;
      return;
    }
    try {
      await api('/api/brindes/log', { method: 'POST', body: JSON.stringify(payload) });
      $('#brindeLogFormWrap').hidden = true;
      await loadBrindes();
    } catch (e) {
      $('#brindeLogFormError').textContent = e.message;
      $('#brindeLogFormError').hidden = false;
    }
  };

  // ---------- Retiradas Internas (38ª rodada) ----------
  // Registro de retirada interna de brinde/vinho -- pedido da Raquel:
  // "deve ter uma lista pré cadastrada de todos os brindes das marcas
  // GhelPlus e De Bacco e também a opção de cadastrar novos, além de
  // vinhos. deve ter a data da retirada, produto retirado, quem retirou e
  // motivo." A lista pré-cadastrada reaproveita o catálogo de Brindes já
  // existente (mesmo GET /api/brindes/catalog usado em Controle Geral);
  // vinho é só mais um grupo dentro desse mesmo catálogo (ver
  // routes/retiradasInternas.js).
  let retiradasBrand = 'debacco';
  let retiradasItems = [];
  let retiradasCatalog = [];

  function retiradaProdutoOptionsHTML() {
    const sorted = retiradasCatalog.slice().sort((a, b) => (a.item || '').localeCompare(b.item || ''));
    const opts = sorted.map((it) => `<option value="${it.id}">${it.item}${it.group ? ' — ' + it.group : ''}</option>`);
    opts.push('<option value="__novo__">+ Cadastrar novo produto...</option>');
    return opts.join('');
  }

  async function loadRetiradas() {
    $('#retiradasNewBtn').hidden = !canEditBrindes();
    $all('.tab-btn[data-retiradas-brand]').forEach((b) => b.classList.toggle('active', b.dataset.retiradasBrand === retiradasBrand));
    const [retiradasRes, catalogRes] = await Promise.all([
      api('/api/retiradas-internas?brand=' + retiradasBrand),
      api('/api/brindes/catalog?brand=' + retiradasBrand)
    ]);
    retiradasItems = retiradasRes.items;
    retiradasCatalog = catalogRes.items;
    renderRetiradas();
  }

  function renderRetiradas() {
    const body = $('#retiradasBody');
    body.innerHTML = '';
    const editable = canEditBrindes();
    $('#retiradasEmpty').hidden = retiradasItems.length > 0;
    retiradasItems.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(r.date)}</td>
        <td>${r.item}</td>
        <td>${r.withdrawnByName || ''}</td>
        <td>${r.motivo || ''}</td>
        <td></td>
      `;
      if (editable) {
        const actionsTd = tr.querySelector('td:last-child');
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Excluir';
        delBtn.className = 'danger';
        delBtn.onclick = async () => {
          if (!confirm('Excluir esta retirada?')) return;
          await api('/api/retiradas-internas/' + r.id, { method: 'DELETE' });
          await loadRetiradas();
        };
        actionsTd.appendChild(delBtn);
      }
      body.appendChild(tr);
    });
  }

  $all('.tab-btn[data-retiradas-brand]').forEach((b) => {
    b.onclick = () => {
      retiradasBrand = b.dataset.retiradasBrand;
      $('#retiradaFormWrap').hidden = true;
      loadRetiradas();
    };
  });

  function openRetiradaForm() {
    $('#retiradaFormDate').value = new Date().toISOString().slice(0, 10);
    $('#retiradaFormUser').innerHTML = ['<option value="">Selecione...</option>']
      .concat(teamMembers.map((u) => `<option value="${u.id}">${u.name}</option>`)).join('');
    $('#retiradaFormProdutoSelect').innerHTML = retiradaProdutoOptionsHTML();
    $('#retiradaFormProdutoSelect').value = '';
    $('#retiradaFormNovoProdutoRow').hidden = true;
    $('#retiradaFormNovoProdutoNome').value = '';
    $('#retiradaFormNovoProdutoGrupo').value = '';
    $('#retiradaFormMotivo').value = '';
    $('#retiradaFormError').hidden = true;
    $('#retiradaFormWrap').hidden = false;
  }
  $('#retiradasNewBtn').onclick = openRetiradaForm;
  $('#retiradaFormCancel').onclick = () => { $('#retiradaFormWrap').hidden = true; };
  $('#retiradaFormProdutoSelect').onchange = () => {
    $('#retiradaFormNovoProdutoRow').hidden = $('#retiradaFormProdutoSelect').value !== '__novo__';
  };
  $('#retiradaFormSave').onclick = async () => {
    const produtoSelect = $('#retiradaFormProdutoSelect').value;
    const isNovo = produtoSelect === '__novo__';
    const payload = {
      brand: retiradasBrand,
      date: $('#retiradaFormDate').value,
      withdrawnBy: $('#retiradaFormUser').value,
      motivo: $('#retiradaFormMotivo').value.trim()
    };
    if (isNovo) {
      payload.item = $('#retiradaFormNovoProdutoNome').value.trim();
      payload.group = $('#retiradaFormNovoProdutoGrupo').value.trim();
    } else {
      const catalogItem = retiradasCatalog.find((it) => it.id === produtoSelect);
      payload.catalogItemId = produtoSelect;
      payload.item = catalogItem ? catalogItem.item : '';
    }
    if (!payload.item) {
      $('#retiradaFormError').textContent = 'Escolha ou cadastre o produto retirado.';
      $('#retiradaFormError').hidden = false;
      return;
    }
    if (!payload.withdrawnBy) {
      $('#retiradaFormError').textContent = 'Escolha quem retirou.';
      $('#retiradaFormError').hidden = false;
      return;
    }
    try {
      await api('/api/retiradas-internas', { method: 'POST', body: JSON.stringify(payload) });
      $('#retiradaFormWrap').hidden = true;
      await loadRetiradas();
    } catch (e) {
      $('#retiradaFormError').textContent = e.message;
      $('#retiradaFormError').hidden = false;
    }
  };

  // ---------- Produtos (33ª rodada) ----------
  // "Análise de Concorrência" e "Lançamentos de Produtos" -- mesmo padrão
  // de permissão (produtos = editor/admin) já usado em Brindes, e mesmo
  // estilo de formulário simples via prompt() já usado lá também (rápido
  // de usar, sem precisar de um modal novo pra cada campo).
  const BRANDS_PRODUTOS = ['debacco', 'ghelplus'];
  let produtosTab = 'concorrencia';
  let concorrenciaItems = [];
  let lancamentosItems = [];
  let concorrenciaBrandFilter = 'todos';
  let lancamentosBrandFilter = 'todos';
  let editingConcorrenciaId = null;
  let editingLancamentoId = null;
  // 39ª rodada, pedido da Raquel: status trocou pro fluxo de lançamento
  // físico (era planejado/em_andamento/lançado). Lançamento antigo com um
  // status do conjunto anterior não é migrado sozinho -- continua com o
  // valor salvo (aparece cru na tabela, já que não está no mapa) até
  // alguém abrir e salvar de novo escolhendo um status atual.
  const LANCAMENTO_STATUS_LABEL = { certificacao: 'Certificação', compra: 'Compra', fiscal: 'Fiscal', liberado: 'Liberado' };

  function canEditProdutos() {
    if (!currentUser) return false;
    if (currentUser.isSuperAdmin) return true;
    const access = (currentUser.permissions || {}).produtos || 'none';
    return access === 'editor' || access === 'admin';
  }

  async function openProdutos(tab) {
    produtosTab = tab === 'lancamentos' ? 'lancamentos' : 'concorrencia';
    showView('produtos');
    $('#produtosConcorrenciaWrap').hidden = produtosTab !== 'concorrencia';
    $('#produtosLancamentosWrap').hidden = produtosTab !== 'lancamentos';
    $('#produtosTitle').textContent = produtosTab === 'lancamentos' ? 'Produtos — Lançamentos de Produtos' : 'Produtos — Análise de Concorrência';
    if (produtosTab === 'concorrencia') {
      await loadConcorrencia();
    } else {
      await loadLancamentos();
    }
  }

  async function loadConcorrencia() {
    try {
      const data = await api('/api/produtos/concorrencia');
      concorrenciaItems = data.items || [];
      renderConcorrencia();
    } catch (e) { alert(e.message); }
  }

  // 39ª rodada, pedido da Raquel: "concorrente x nossa marca... lado a
  // lado" -- a listagem virou uma lista de cartões (não mais uma tabela),
  // um cartão por análise, com os dois lados lado a lado dentro dele
  // (mesmo layout comparativo do formulário).
  function renderConcorrencia() {
    $('#concorrenciaNewBtn').hidden = !canEditProdutos();
    const rows = concorrenciaItems.filter((it) => concorrenciaBrandFilter === 'todos' || it.brand === concorrenciaBrandFilter);
    const list = $('#concorrenciaList');
    $('#concorrenciaEmpty').hidden = rows.length > 0;
    function campo(label, value) {
      return `<div class="compare-field"><b>${label}</b>${value}</div>`;
    }
    function precoTxt(v) { return v === null || v === undefined ? '—' : fmtMoney(v); }
    function linkTxt(v) { return v ? `<a href="${v}" target="_blank" rel="noopener">${v}</a>` : '—'; }
    list.innerHTML = rows.map((it) => `
      <div class="compare-card">
        <div class="compare-card-head">
          <h4>${BRAND_LABEL[it.brand] || it.brand} · ${it.concorrente}</h4>
          ${canEditProdutos() ? `<span><button class="btn-link" data-edit-concorrencia="${it.id}">Editar</button> <button class="btn-link danger" data-del-concorrencia="${it.id}">Excluir</button></span>` : ''}
        </div>
        <div class="compare-card-body">
          <div>
            <h4>${it.concorrente}</h4>
            ${campo('Produto', it.produto || '—')}
            ${campo('Preço', precoTxt(it.preco))}
            ${campo('Diferenciais', it.diferenciais || '—')}
            ${campo('Observações', it.observacoes || '—')}
            ${campo('Link', linkTxt(it.link))}
          </div>
          <div class="compare-vs">×</div>
          <div>
            <h4>Nossa marca</h4>
            ${campo('Produto', it.nossoProduto || '—')}
            ${campo('Preço', precoTxt(it.nossoPreco))}
            ${campo('Diferenciais', it.nossoDiferenciais || '—')}
            ${campo('Observações', it.nossasObservacoes || '—')}
            ${campo('Link', linkTxt(it.nossoLink))}
          </div>
        </div>
      </div>
    `).join('');
    $all('[data-edit-concorrencia]').forEach((b) => {
      b.onclick = () => openConcorrenciaForm(concorrenciaItems.find((it) => it.id === b.dataset.editConcorrencia));
    });
    $all('[data-del-concorrencia]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Excluir esta análise de concorrência?')) return;
        await api('/api/produtos/concorrencia/' + b.dataset.delConcorrencia, { method: 'DELETE' });
        await loadConcorrencia();
      };
    });
  }

  function openConcorrenciaForm(item) {
    editingConcorrenciaId = item ? item.id : null;
    $('#concorrenciaFormTitle').textContent = item ? 'Editar análise' : 'Nova análise';
    $('#concorrenciaFormBrand').value = item ? item.brand : 'debacco';
    $('#concorrenciaFormConcorrente').value = item ? item.concorrente : '';
    $('#concorrenciaFormProduto').value = item ? (item.produto || '') : '';
    $('#concorrenciaFormPreco').value = item && item.preco !== null && item.preco !== undefined ? item.preco : '';
    $('#concorrenciaFormDiferenciais').value = item ? (item.diferenciais || '') : '';
    $('#concorrenciaFormLink').value = item ? (item.link || '') : '';
    $('#concorrenciaFormObservacoes').value = item ? (item.observacoes || '') : '';
    $('#concorrenciaFormNossoProduto').value = item ? (item.nossoProduto || '') : '';
    $('#concorrenciaFormNossoPreco').value = item && item.nossoPreco !== null && item.nossoPreco !== undefined ? item.nossoPreco : '';
    $('#concorrenciaFormNossoDiferenciais').value = item ? (item.nossoDiferenciais || '') : '';
    $('#concorrenciaFormNossoLink').value = item ? (item.nossoLink || '') : '';
    $('#concorrenciaFormNossasObservacoes').value = item ? (item.nossasObservacoes || '') : '';
    $('#concorrenciaFormError').hidden = true;
    $('#concorrenciaFormWrap').hidden = false;
  }
  $('#concorrenciaNewBtn').onclick = () => openConcorrenciaForm(null);
  $('#concorrenciaFormCancel').onclick = () => { $('#concorrenciaFormWrap').hidden = true; };
  $('#concorrenciaFormSave').onclick = async () => {
    const payload = {
      brand: $('#concorrenciaFormBrand').value,
      concorrente: $('#concorrenciaFormConcorrente').value.trim(),
      produto: $('#concorrenciaFormProduto').value.trim(),
      preco: $('#concorrenciaFormPreco').value || null,
      diferenciais: $('#concorrenciaFormDiferenciais').value.trim(),
      link: $('#concorrenciaFormLink').value.trim(),
      observacoes: $('#concorrenciaFormObservacoes').value.trim(),
      nossoProduto: $('#concorrenciaFormNossoProduto').value.trim(),
      nossoPreco: $('#concorrenciaFormNossoPreco').value || null,
      nossoDiferenciais: $('#concorrenciaFormNossoDiferenciais').value.trim(),
      nossoLink: $('#concorrenciaFormNossoLink').value.trim(),
      nossasObservacoes: $('#concorrenciaFormNossasObservacoes').value.trim()
    };
    if (!payload.concorrente) {
      $('#concorrenciaFormError').textContent = 'Informe o nome do concorrente.';
      $('#concorrenciaFormError').hidden = false;
      return;
    }
    try {
      if (editingConcorrenciaId) {
        await api('/api/produtos/concorrencia/' + editingConcorrenciaId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/produtos/concorrencia', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#concorrenciaFormWrap').hidden = true;
      await loadConcorrencia();
    } catch (e) {
      $('#concorrenciaFormError').textContent = e.message;
      $('#concorrenciaFormError').hidden = false;
    }
  };
  $all('.tab-btn[data-concorrencia-brand]').forEach((b) => {
    b.onclick = () => {
      concorrenciaBrandFilter = b.dataset.concorrenciaBrand;
      $all('.tab-btn[data-concorrencia-brand]').forEach((x) => x.classList.toggle('active', x === b));
      renderConcorrencia();
    };
  });

  async function loadLancamentos() {
    try {
      const data = await api('/api/produtos/lancamentos');
      lancamentosItems = data.items || [];
      renderLancamentos();
    } catch (e) { alert(e.message); }
  }

  function renderLancamentos() {
    $('#lancamentosNewBtn').hidden = !canEditProdutos();
    const rows = lancamentosItems
      .filter((it) => lancamentosBrandFilter === 'todos' || it.brand === lancamentosBrandFilter)
      .slice()
      .sort((a, b) => {
        if (!a.dataLancamento && !b.dataLancamento) return 0;
        if (!a.dataLancamento) return 1;
        if (!b.dataLancamento) return -1;
        return a.dataLancamento.localeCompare(b.dataLancamento);
      });
    const body = $('#lancamentosBody');
    $('#lancamentosEmpty').hidden = rows.length > 0;
    body.innerHTML = rows.map((it) => `
      <tr>
        <td>${BRAND_LABEL[it.brand] || it.brand}</td>
        <td>${it.produto || '—'}</td>
        <td>${it.nome}</td>
        <td>${it.codigo || '—'}</td>
        <td>${it.dataLancamento ? fmtDate(it.dataLancamento) : '—'}</td>
        <td>${LANCAMENTO_STATUS_LABEL[it.status] || it.status}</td>
        <td>${(it.arquivos || []).length}</td>
        <td>${canEditProdutos() ? `<button class="btn-link" data-edit-lancamento="${it.id}">Editar</button> <button class="btn-link danger" data-del-lancamento="${it.id}">Excluir</button>` : ''}</td>
      </tr>
    `).join('');
    $all('[data-edit-lancamento]').forEach((b) => {
      b.onclick = () => openLancamentoForm(lancamentosItems.find((it) => it.id === b.dataset.editLancamento));
    });
    $all('[data-del-lancamento]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Excluir este lançamento?')) return;
        await api('/api/produtos/lancamentos/' + b.dataset.delLancamento, { method: 'DELETE' });
        await loadLancamentos();
      };
    });
  }

  // Arquivos do lançamento (39ª rodada) -- mesmo padrão já usado em
  // Demandas: lista com botão de excluir por arquivo.
  function renderLancamentoFiles(item) {
    const wrap = $('#lancamentoFiles');
    wrap.innerHTML = '';
    (item && item.arquivos || []).forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener">${f.name}</a> <span class="muted">(${fmtBytes(f.size)})</span>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'btn-link';
      delBtn.onclick = async () => {
        await api(`/api/produtos/lancamentos/${item.id}/files/${f.id}`, { method: 'DELETE' });
        const data = await api('/api/produtos/lancamentos');
        lancamentosItems = data.items || [];
        renderLancamentoFiles(lancamentosItems.find((it) => it.id === item.id));
        renderLancamentos();
      };
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  function openLancamentoForm(item) {
    editingLancamentoId = item ? item.id : null;
    $('#lancamentoFormTitle').textContent = item ? 'Editar lançamento' : 'Novo lançamento';
    $('#lancamentoFormBrand').value = item ? item.brand : 'debacco';
    $('#lancamentoFormProduto').value = item ? (item.produto || '') : '';
    $('#lancamentoFormNome').value = item ? item.nome : '';
    $('#lancamentoFormCodigo').value = item ? (item.codigo || '') : '';
    $('#lancamentoFormData').value = item ? (item.dataLancamento || '') : '';
    $('#lancamentoFormStatus').value = item ? item.status : 'certificacao';
    $('#lancamentoFormDiferenciais').value = item ? (item.diferenciais || '') : '';
    $('#lancamentoFormDescricao').value = item ? (item.descricao || '') : '';
    $('#lancamentoFormError').hidden = true;
    // Upload de arquivo só depois de o lançamento existir (precisa do id
    // na URL) -- mesmo comportamento já usado em Demandas.
    $('#lancamentoFileInput').value = '';
    $('#lancamentoFileInput').style.display = item ? '' : 'none';
    renderLancamentoFiles(item);
    $('#lancamentoFormWrap').hidden = false;
  }
  $('#lancamentosNewBtn').onclick = () => openLancamentoForm(null);
  $('#lancamentoFormCancel').onclick = () => { $('#lancamentoFormWrap').hidden = true; };
  $('#lancamentoFileInput').onchange = async () => {
    const file = $('#lancamentoFileInput').files[0];
    if (!file || !editingLancamentoId) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/produtos/lancamentos/${editingLancamentoId}/files`, { method: 'POST', body: fd });
      $('#lancamentoFileInput').value = '';
      const data = await api('/api/produtos/lancamentos');
      lancamentosItems = data.items || [];
      renderLancamentoFiles(lancamentosItems.find((it) => it.id === editingLancamentoId));
      // Atualiza também a contagem de arquivos na tabela por trás do
      // formulário -- sem isso, ela só refletia o upload depois de fechar
      // e reabrir a tela (achado no teste desta rodada).
      renderLancamentos();
    } catch (e) {
      alert(e.message);
    }
  };
  $('#lancamentoFormSave').onclick = async () => {
    const payload = {
      brand: $('#lancamentoFormBrand').value,
      produto: $('#lancamentoFormProduto').value.trim(),
      nome: $('#lancamentoFormNome').value.trim(),
      codigo: $('#lancamentoFormCodigo').value.trim(),
      dataLancamento: $('#lancamentoFormData').value || null,
      status: $('#lancamentoFormStatus').value,
      diferenciais: $('#lancamentoFormDiferenciais').value.trim(),
      descricao: $('#lancamentoFormDescricao').value.trim()
    };
    if (!payload.nome) {
      $('#lancamentoFormError').textContent = 'Informe o nome do produto.';
      $('#lancamentoFormError').hidden = false;
      return;
    }
    try {
      let savedId = editingLancamentoId;
      if (editingLancamentoId) {
        await api('/api/produtos/lancamentos/' + editingLancamentoId, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const created = await api('/api/produtos/lancamentos', { method: 'POST', body: JSON.stringify(payload) });
        savedId = created.item.id;
      }
      await loadLancamentos();
      // Se acabou de criar (não estava editando), reabre já em modo edição
      // pra liberar o upload de arquivos -- sem isso, quem cria e quer
      // anexar um arquivo teria que salvar, fechar e abrir de novo.
      if (!editingLancamentoId && savedId) {
        openLancamentoForm(lancamentosItems.find((it) => it.id === savedId));
      } else {
        $('#lancamentoFormWrap').hidden = true;
      }
    } catch (e) {
      $('#lancamentoFormError').textContent = e.message;
      $('#lancamentoFormError').hidden = false;
    }
  };
  $all('.tab-btn[data-lancamentos-brand]').forEach((b) => {
    b.onclick = () => {
      lancamentosBrandFilter = b.dataset.lancamentosBrand;
      $all('.tab-btn[data-lancamentos-brand]').forEach((x) => x.classList.toggle('active', x === b));
      renderLancamentos();
    };
  });
  $('#homeGoLancamentos').onclick = () => { $('#navProdutosLancamentos').click(); };

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
  function applyInfluencersTabView() {
    if (influencersTab === 'todas') {
      $('#influencersList').hidden = true;
      $('#influencersEmpty').hidden = true;
      $('#influencerNewBtn').hidden = true;
      $('#influencerAllWrap').hidden = false;
      loadInfluencerAllPosts();
    } else {
      $('#influencerAllWrap').hidden = true;
      $('#influencerNewBtn').hidden = false;
      $('#influencersList').hidden = false;
      renderInfluencersList();
    }
  }

  $all('[data-inf-tab]').forEach((b) => {
    b.onclick = () => {
      influencersTab = b.dataset.infTab;
      $all('[data-inf-tab]').forEach((x) => x.classList.toggle('active', x.dataset.infTab === influencersTab));
      $('#influencerTableWrap').hidden = true;
      $('#influencerFormWrap').hidden = true;
      applyInfluencersTabView();
    };
  });

  $all('[data-all-brand]').forEach((b) => {
    b.onclick = () => {
      influencerAllBrandFilter = b.dataset.allBrand;
      $all('[data-all-brand]').forEach((x) => x.classList.toggle('active', x.dataset.allBrand === influencerAllBrandFilter));
      renderInfluencerAllPosts();
    };
  });

  async function loadInfluencerAllPosts() {
    try {
      const data = await api('/api/influencers/all/posts');
      influencerAllPosts = data.posts;
      renderInfluencerAllPosts();
    } catch (e) {
      alert(e.message);
    }
  }

  function renderInfluencerAllPosts() {
    const body = $('#influencerAllBody');
    body.innerHTML = '';
    const list = influencerAllBrandFilter === 'todos' ? influencerAllPosts : influencerAllPosts.filter((p) => p.brand === influencerAllBrandFilter);
    $('#influencerAllEmpty').hidden = list.length > 0;
    list.forEach((p) => {
      const tr = document.createElement('tr');
      if (p.rede && INFLUENCER_REDE_COLOR[p.rede]) {
        tr.style.background = `color-mix(in srgb, ${INFLUENCER_REDE_COLOR[p.rede]} 12%, white)`;
      }
      tr.innerHTML = `
        <td>${p.influencerName}</td>
        <td>${BRAND_LABEL[p.brand] || p.brand}</td>
        <td>${p.formato || '—'}</td>
        <td>${networkIconHtml(p.rede)} ${SOCIAL_PLATFORM_LABEL[p.rede] || p.rede || '—'}</td>
        <td>${influencerStatusPillHTML(p.status, false)}</td>
        <td>${p.dataPostagem ? fmtDate(p.dataPostagem) : '—'}</td>
        <td>${p.arquivo ? `<a href="${p.arquivo.url}" target="_blank" rel="noopener">${p.arquivo.name}</a>` : '—'}</td>
        <td>${p.observacoes || '—'}</td>
        <td>${p.notas || '—'}</td>
      `;
      body.appendChild(tr);
    });
  }

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
      applyInfluencersTabView();
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
        <td>${networkIconHtml(p.rede)} ${SOCIAL_PLATFORM_LABEL[p.rede] || p.rede || '—'}</td>
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
    influencerInvolvedIds = new Set(post ? (post.involvedUserIds || []) : []);
    renderInfluencerInvolvedChips();
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
      dataSaida: $('#influencerPostFormParceria').value === 'permuta' ? ($('#influencerPostFormDataSaida').value || null) : null,
      involvedUserIds: Array.from(influencerInvolvedIds)
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
  setupDashboardPublicLink('acoesSazonais', 'acoes');

  boot();
})();
