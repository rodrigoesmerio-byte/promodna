# PromoDNA API

Backend seguro para conectores autorizados do PromoDNA. Ele mantém credenciais fora do GitHub Pages, aplica CORS, cache e limite de requisições e normaliza dados de cada marketplace para um formato comum.

## Rotas

- `GET /health`: integridade do serviço.
- `GET /v1/sources`: situação dos conectores.
- `GET /v1/search?q=...`: busca oficial no Mercado Livre quando autorizado.
- `GET /admin`: tela protegida para iniciar o OAuth.
- `GET /oauth/mercadolivre/callback`: retorno fixo cadastrado no DevCenter.

## Segurança

- Client secret e tokens nunca são enviados ao frontend.
- Tokens rotativos ficam no Google Secret Manager.
- O refresh token novo substitui o anterior automaticamente.
- Nenhum header de autorização ou token é escrito nos logs.
- Apenas as origens configuradas recebem cabeçalhos CORS.

## Estado dos preços

A primeira consulta contém preço atual e, quando disponível, preço de referência informado pela fonte. Ela não é chamada de histórico de 30/90 dias. As medianas históricas só devem aparecer depois que o coletor persistente acumular observações suficientes.
