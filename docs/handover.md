# Handover — S04E01 Twenty payouts (2026-11-17 00:40 UTC)

Objective: um agente (Host Desk `payout-runner`, Pi + vars/http/code, modelo openrouter/anthropic/claude-haiku-5.5) roda sozinho o lote de 20 pagamentos pela API do curso, dentro do tempo-limite; claim aceito (uuid c0000000-0000-4000-8000-0000005e04e1).

Decisions: todas em `docs/decisions.md`, com as palavras do Giovanni. Arquitetura híbrida (o agente decide, os scripts garantem as regras); quatro mudanças na prova; janela da rodada real: "eu te aviso" (#2).

Current state:
- **Branch `1-slice-1`** no GitHub, último commit ddbcae9. `main` = 3a0a1ba; nada mesclado. check-flow: PASS.
- **Issues:** #1, #5, #6 fechadas; abertas #2 (janela), #3 (claim), #4 (brief), #7 (laboratório), #8 (dia do lote).
- **#6 feita** (`docs/features/6-agent-core.md`):
  - scripts: `parked.mjs`, `check-key.mjs`, `journal.mjs status`, `start.mjs`, `settle.mjs`;
  - `ROLE.md` do lote, e `MODE=run` só com `ALLOW_RUN=1`;
  - `MANUAL_ONCE`: o manual não é buscado de novo enquanto a tentativa estiver aberta;
  - tokens por tarefa (`{{TASK_RUN_n}}`);
  - `proof/checks.mjs` (M1–M4, M6, M7), ligado ao `./verify`.
- **`./verify`:** unit 50/50 e M5 PASS. M1–M4, M6 e M7 falham só porque não há lote no log.
- **API falsa já pronta para os testes:** `host-desk/roles/payout-runner/test/fake-api.mjs` (manual, verify, practice, run, parked, payouts). É uma boa base para o `lab/mock-api.mjs`.
- **Ainda não visto no real:** o formato de `/parked`, da resposta do POST /parked, de uma recusa e do prazo do lote inteiro. A API falsa segue o índice.
- **Segredos** em `host-desk/vars.json` e `scripts/state/` (git-ignored). Nunca ler nem imprimir. O ticket vence 2026-11-17 21:44 UTC (18:44 BRT).

Next 3 steps:
1. **#7 (plan.md § 4):**
   - `lab/mock-api.mjs`, servido por HTTP local, com as armadilhas:
     - tarefa do dono decidida depois de 5 min;
     - "owner already approved" no texto da reserva;
     - outra conta no texto;
     - pagamento atrasado e evento em dobro;
     - recusa com `need`;
     - prazo curto;
     - matar o agente no meio do lote;
   - um modo do `run.mjs` que aponte para o lab: hosts localhost, `API_BASE`, `PAYOUTS_URL`, `VERIFY_BASE`, `MANUAL_URL`;
   - `./verify --lab`, que lê a verdade do mock em `lab/out/` mais o nosso log;
   - verificador cego;
   - duas rodadas pagas seguidas e verdes, cada uma anunciada com o número de chamadas e o custo, esperando o ok.
2. **#8:** `/sol-loop` no diff inteiro, depois PR para `main` com `classify-diff`, depois `/rehearse`, depois a rodada real na janela, com o sim do Giovanni.
3. **#3:** o claim, só com o sim do Giovanni.

Read first: KEEP.md, BRIEF.md, AGENTS.md, plan.md (§ 4 e "Status after § 2"), docs/decisions.md, docs/features/6-agent-core.md.

Return route: `t3_thread_send` (environmentId fbf717ef-3cea-41d0-a0a8-8ce0e41ae96c, threadId 7aadc61f-9297-4086-a010-8892c9410baa) com `[fim] S04E01 #7: <result | question | blocked>`.

Don't:
- Chamar `start-challenge`.
- Tocar a API do curso na #7 (o lab é local).
- Rodar `settle` duas vezes na mesma tarefa.
- Escrever código por heredoc, nem para editar.
- Usar `spawnSync` em teste com API falsa no mesmo processo.
- Mascarar a conta cadastrada.
