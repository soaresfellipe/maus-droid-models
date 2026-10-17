# Maus Droid Models

[English](README.md) | Português (Brasil)

Patch independente para integrar os modelos autorizados do **Factory Droid**
ao **OpenMausBot**, com seleção de reasoning effort por modelo e multiplicadores
de créditos nos nomes.

Não é um fork completo do OpenMausBot, nem inclui o binário do Droid.

## Funcionalidades

- Consulta `droid.list_models` usando a conta já autenticada no Droid.
- Exclui modelos bloqueados, sem permitir reintroduzi-los pelas configurações.
- Preserva modelos personalizados, favoritos e o modelo padrão permitido.
- Reutiliza o último catálogo válido da instância se uma consulta falhar.
- Acrescenta multiplicadores como `Inkling · 0.4x` e `GLM-5.3-Flash · 0.06x`.
- Mostra `Dynamic` para o roteador automático, sem estimar preços de modelos personalizados.
- Usa as variantes existentes da interface para os níveis de effort anunciados por cada modelo.
- Seleciona modelo e effort pelo ACP, confirmando a configuração antes do prompt.
- Preserva a seleção de modelo nas chamadas de memória em segundo plano.

A quantidade de modelos e os multiplicadores vêm do Droid. Não há uma lista
fixa de modelos autorizados neste projeto. O multiplicador é uma referência
relativa, **não o custo final de uma mensagem**.

## Compatibilidade e requisitos

Validado com **OpenMausBot 0.1.110**, **Droid 0.243.0** e **Node.js 24** no Linux.

Requer `python3`, GNU `patch`, `node` e uma instalação do OpenMausBot.
Para consultar modelos ou gerar respostas reais, o Droid precisa estar instalado
e autenticado. O projeto não inclui nem pede suas credenciais.

O patch altera apenas:

- `dist-server/index.js`, o bundle executado pelo servidor.
- `dist-server/server/drivers/acp/droid.js`, o driver equivalente.

Não altera frontend, configurações, cache ou autenticação. Não reinicia o servidor.

## Instalar ou reaplicar após uma atualização

Clone fora do diretório do pacote npm, para não perder o patch em atualizações:

```sh
git clone https://github.com/soaresfellipe/maus-droid-models.git
cd maus-droid-models
```

O diretório padrão é `~/.local/lib/node_modules/openmausbot`:

```sh
python3 reapply.py --check
python3 reapply.py
```

Se o npm global usa outro local:

```sh
python3 reapply.py --root "$(npm root -g)/openmausbot" --check
python3 reapply.py --root "$(npm root -g)/openmausbot"
```

Depois, reinicie o OpenMausBot quando puder interromper as conversas e atualize
os modelos do Droid na interface. O seletor deve mostrar os multiplicadores e
as opções de effort do modelo selecionado.

Execute novamente o reaplicador após atualizar o pacote npm. **Não force o patch**
se uma versão futura já tiver resolvido o problema ou mudado o driver.

## Segurança da reaplicação

- Aplica primeiro em cópias temporárias e valida ambos os arquivos com `node --check`.
- Aceita deslocamentos de linhas, mas não diferenças de contexto (`--fuzz=0`).
- Não modifica a instalação com `--check` nem quando o patch completo já está aplicado.
- Interrompe diante de código incompatível, aplicação parcial ou sintaxe inválida.
- Confere se os arquivos mudaram durante a operação.
- Cria backups com data UTC antes de substituir os arquivos.
- Tenta restaurar o primeiro arquivo se a escrita do segundo falhar.

Cada substituição é atômica, mas os dois arquivos não formam uma transação única.
Se outro processo modificar um arquivo durante o rollback, o reaplicador preserva
essa alteração e informa que a restauração precisa ser manual. Não rode junto de
uma atualização npm.

Uma instalação com somente a versão anterior deste patch, que tratava apenas do
catálogo, não é reconhecida como aplicação completa. O reaplicador para sem
alterar os arquivos. Após uma atualização npm que restaure os arquivos originais,
ele pode aplicar o patch completo.

## Testes

Os sete testes do reaplicador usam apenas fixtures em diretórios temporários:

```sh
python3 test_reapply.py
```

Os testes Node leem uma instalação **já corrigida** do OpenMausBot. O diretório
padrão é o mesmo do reaplicador; para outro local, defina `OPENMAUSBOT_ROOT`:

```sh
node --test tests/models.test.mjs tests/metadata.integration.test.mjs

# Alternativa para uma instalação global em outro local:
OPENMAUSBOT_ROOT="$(npm root -g)/openmausbot" \
  node --test tests/models.test.mjs tests/metadata.integration.test.mjs
```

Por padrão, esses testes não consultam a conta nem geram respostas reais.
A integração usa o driver extraído do próprio bundle e um CLI simulado,
sem iniciar outro servidor. Esse recorte depende da estrutura do bundle da
versão validada.

### Testes reais opcionais

**Podem consumir créditos.** Usam a autenticação local existente, sem gravá-la
no repositório. O executável padrão é `droid`; use `DROID_CLI` para outro caminho.

```sh
DROID_MODELS_LIVE=1 node --test tests/models.test.mjs
DROID_METADATA_LIVE=1 node --test tests/metadata.integration.test.mjs
```

Foram confirmados `low` e `high` do Inkling pelo protocolo ACP, com respostas
reais e troca de effort na mesma sessão. Os testes também cobrem filtros,
multiplicadores, modelos personalizados, falhas, isolamento de instâncias,
reaplicação idempotente e rejeição de variantes não anunciadas.

Não publique `.factory`, `.openmausbot`, `.env`, logs, cache ou credenciais.
Esses dados não fazem parte do projeto.

## Limitação conhecida do Droid

No Droid **0.243.0**, o Inkling anuncia `minimal` e aceita esse valor na
configuração ACP, mas o backend pode rejeitá-lo ao gerar a resposta. A rejeição
foi reproduzida diretamente no Droid, sem o OpenMausBot. `low` e `high` foram
confirmados em respostas reais.

O patch mostra os níveis anunciados pelo Droid e **não troca silenciosamente**
um nível rejeitado por outro. Não foram testados todos os níveis de todos os
modelos.

## Reverter

Restaure **os dois backups da mesma execução**, nos caminhos impressos pelo
reaplicador, e reinicie o servidor. Use backups da versão atualmente instalada,
não de uma versão anterior do OpenMausBot.

## Licença e origem

Apache-2.0. O patch e as fixtures de referência derivam do driver do
[OpenMausBot](https://github.com/milind-soni/OpenMausBot), distribuído sob
Apache-2.0. Consulte `LICENSE` e `NOTICE`.

Projeto independente, sem vínculo oficial com o OpenMausBot ou a Factory.
