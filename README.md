# Plataforma de Gestão de Marketing — GhelPlus & De Bacco

Ponto único de entrada para os dashboards de marketing (Tráfego Pago, Ações
Sazonais e Redes Sociais), com **login único**, **permissões por usuário** e
uma aba própria de **Orçamento planejado x realizado**.

## O que ela faz

- Login único: você entra uma vez na plataforma e, ao clicar em um dashboard,
  entra direto nele — sem digitar usuário/senha de novo.
- Cada usuário tem permissões independentes por dashboard (sem acesso /
  editor / admin) e para a aba de Orçamento — controlado em **Usuários**
  (só quem é "administrador da plataforma" vê essa aba).
- Aba **Orçamento**: lançamentos de planejado x realizado por marca,
  categoria, mês e ano, com totais automáticos. (v1 é lançamento manual —
  puxar "realizado" automaticamente da Ações Sazonais/Tráfego Pago é o
  próximo passo natural.)

## Como o login único funciona (IMPORTANTE)

Os 3 dashboards (Tráfego Pago, Ações Sazonais, Redes Sociais) e esta
plataforma usam o mesmo mecanismo de autenticação (JWT). A plataforma emite
um token igualzinho ao que cada dashboard já sabe validar — a única
exigência é que **todos os 4 projetos usem o mesmo valor de `JWT_SECRET`**
nas Variables do Railway.

Passo a passo (fazer uma vez só):

1. Escolha um valor aleatório e longo para `JWT_SECRET` (ex: gere uma senha
   forte de 40+ caracteres).
2. Nas Variables do Railway de **cada um dos 4 projetos** (esta plataforma +
   Tráfego Pago + Ações Sazonais + Redes Sociais), defina `JWT_SECRET` com
   esse mesmo valor exato.
3. Redeploy os 4 (qualquer novo `git push` já redeploya).

Sem isso alinhado, o login único não funciona — cada app vai continuar
pedindo login separado (não quebra nada, só não faz a parte de "entrar
direto").

Além disso, defina nas Variables desta plataforma as URLs de produção dos 3
dashboards (ver `.env.example`): `TRAFEGO_PAGO_URL`, `ACOES_SAZONAIS_URL`,
`REDES_SOCIAIS_URL`.

## Rodando localmente

```bash
npm install
cp .env.example .env
# edite o .env: troque o JWT_SECRET e confira as URLs dos dashboards
npm start
```

Abra `http://localhost:3000`. No primeiro acesso, crie o usuário
administrador da plataforma.

## Colocando no ar (Railway)

Mesmo processo dos outros 3 dashboards:

1. Crie um repositório no GitHub e suba os arquivos **via terminal** (`git
   add`, `git commit`, `git push`).
2. No Railway, crie um novo projeto a partir desse repositório.
3. Em **Variables**, adicione `JWT_SECRET` (igual aos outros 3 — ver acima),
   `TRAFEGO_PAGO_URL`, `ACOES_SAZONAIS_URL`, `REDES_SOCIAIS_URL`.
4. Em **Settings → Volumes**, monte um volume persistente em `/app/data`
   (senão os usuários cadastrados somem a cada deploy).
5. Gere o domínio público em **Settings → Networking → Generate Domain**.
6. Acesse o link e crie o administrador da plataforma no primeiro acesso.

## Estrutura de pastas

```
plataforma-gestao-marketing/
├── server.js
├── db.js
├── middleware/auth.js       # requireAuth, requireSuperAdmin
├── utils/{id,audit}.js
├── routes/
│   ├── auth.js              # setup, login, usuários e permissões
│   ├── dashboards.js        # lista dashboards + gera o link de acesso direto
│   └── budget.js            # CRUD do orçamento planejado x realizado
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

## Próximos passos sugeridos

- Puxar o "realizado" da aba Orçamento automaticamente das APIs da Ações
  Sazonais (`/api/budgets`) e do Tráfego Pago (`/api/monthly`), em vez de
  lançamento manual.
- Trazer indicadores-resumo de cada dashboard para a tela inicial da
  plataforma (hoje só mostra os cards de acesso).
