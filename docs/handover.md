# Handover — S04E01 Twenty payouts (2026-11-17 00:10 UTC)

Objective: um agente (Host Desk `payout-runner`, Pi + vars/http/code, modelo openrouter/anthropic/claude-haiku-5.5) roda sozinho o lote de 20 pagamentos pela API do curso, dentro do tempo-limite; claim aceito (uuid c0000000-0000-4000-8000-0000005e04e1).

Decisions: todas em `docs/decisions.md`, com as palavras do Giovanni. Destaques de 2026-11-16:
- **Arquitetura híbrida** ("1 - sim"): o agente lê e decide cada tarefa; `scripts/settle.mjs` confere, paga uma vez e responde.
- **Quatro mudanças na prova** ("2 - aprovo"):
  - outra conta vira flag do dono;
  - o flag é a única escrita antes da decisão;
  - M1 e M4 pelas respostas do curso no log + `/parked`;
  - fatia 3 = prática + lote.
- **Issues #4–#8** ("3- aprovo").
- **Janela:** "eu te aviso".

Current state:
- **Branch `1-slice-1`** (no GitHub), último commit c131d1a. `main` = 3a0a1ba; nada foi mesclado ainda. check-flow: PASS.
- **Issues:**
  - #1 e #5 fechadas;
  - abertas: #2 (janela), #3 (claim), #4 (brief), #6 (núcleo), #7 (laboratório), #8 (dia do lote).
- **Fatia 1:** feita. Manual real lido; regras e conta cadastrada no KEEP.md.
- **Prática:** feita pelo agente, 3/3 (run 2026-11-17T00-06-18-066Z).
  - O limite é **8 s por tarefa** (`timeLeftMs: 8000` a cada tarefa).
  - O agente levou 2,2–2,9 s por tarefa.
- **Já construído:**
  - `lib/net.mjs`: allowlist de hosts, READ_ONLY, WRITE_URLS por script, DENY_URLS (bloqueia `/manual`), máscara com captura de ATTEMPT/CUR_TASK/VERIFY_PATH;
  - `lib/batch.mjs`, `lib/flow.mjs`, `scripts/start.mjs`, `scripts/settle.mjs`;
  - `ROLE.slice1.md`, `ROLE.practice.md`;
  - `run.mjs` com `READ_ONLY=1` ou `MODE=practice`;
  - 26 testes.
- **Tentativa nº 1:** vence 2026-11-17 02:04 UTC. Para o lote, abrir uma tentativa nova no dia (um único `GET /manual`).
- **Custo pago até agora:** 3 rodadas haiku, estimadas < US$0,10 no total.
- **Segredos:** em `host-desk/vars.json` e `scripts/state/vars.json` (git-ignored). Nunca ler nem imprimir. O ticket vence 2026-11-17 21:44 UTC (18:44 BRT).

Done when (BRIEF.md): ✘ 20 tarefas no prazo · ✘ tarefas do dono decididas e concluídas · ✘ `./verify` verde · ✘ claim aceito · ✘ debrief · ✘ megadev `challenges/s04e01/log.md` · ✘ nota [fim].

Open questions (Giovanni): a janela da rodada real (#2). Proposta: 17/11, 15:00–16:30 BRT, com go/no-go às 15:00.

Next 3 steps:
1. **#6:**
   - `parked.mjs` (polls ~110 s; on-file / new / decline / null; conta do `new` só de campo estruturado);
   - `check-key.mjs` (usa VERIFY_PATH);
   - `ROLE.md` do lote, a partir de `ROLE.practice.md`: passo 0 lê o diário, um único `/manual`, check-key, start run, loop, flag, parked, resumo;
   - `MODE=run` com `ALLOW_RUN=1` no `run.mjs`;
   - verify M1–M7.
2. **#7:** dublê com o formato real e as armadilhas; `./verify --lab` verde em duas rodadas seguidas (pagas, anunciadas).
3. **#8:** `/sol-loop` no diff inteiro, depois PR para `main` (classify-diff), depois a rodada real na janela, com o sim do Giovanni.

Read first: KEEP.md, BRIEF.md, AGENTS.md, plan.md (seção "Status after § 2"), docs/decisions.md, docs/reviews/2026-11-16-plan.md.

Return route: `t3_thread_send` (environmentId fbf717ef-3cea-41d0-a0a8-8ce0e41ae96c, threadId 7aadc61f-9297-4086-a010-8892c9410baa) com `[fim] S04E01 Twenty payouts: <result | question | blocked>`.

Don't:
- Chamar `start-challenge`.
- Buscar `/manual` fora do início do dia do lote.
- Rodar `settle` duas vezes na mesma tarefa.
- Escrever código por heredoc (use a ferramenta de escrita).
- Usar `spawnSync` em teste com API falsa no mesmo processo.
- Mascarar a conta cadastrada (não é segredo; a máscara quebrou a comparação).
