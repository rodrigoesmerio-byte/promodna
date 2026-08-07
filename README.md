# PromoDNA

Analisador de descontos de uma página específica. A versão atual lê os preços estruturados da categoria da loja, calcula a economia real e ordena as maiores oportunidades sem copiar imagens nem simular navegação humana.

## Site

https://rodrigoesmerio-byte.github.io/promodna/

## Como funciona

1. Abra o PromoDNA e arraste o botão **Analisar descontos** para a barra de favoritos.
2. Abra a categoria desejada na loja compatível.
3. Clique no favorito para iniciar uma análise consciente, dentro da página aberta.
4. O resultado volta ao PromoDNA com preço anterior, preço atual, economia em reais e percentual de desconto.

## Fonte validada

- Época Cosméticos: categorias e resultados de busca.
- Conector inicial testado em `/dermocosmeticos`.
- Analisa até 150 ofertas em estoque, distribuídas em três lotes de 50 e ordenadas pela própria loja por desconto.
- Usa apenas os preços estruturados disponibilizados pela página; o valor exibido no carrinho/checkout continua sendo o definitivo.

## Arquitetura atual

O processamento começa por ação do usuário e roda no domínio da própria loja. O GitHub Pages recebe somente o resultado calculado por `postMessage`, validando a origem da mensagem. Não há CAPTCHA, proxy, falsificação de identidade, navegação oculta nem backend obrigatório.

Os arquivos em `api/` e `scripts/` permanecem no repositório como opção futura para conectores oficiais que exijam servidor, OAuth ou armazenamento seguro de credenciais.

## Próximas fontes

Cada loja precisa de um conector próprio, porque categorias, paginação e formatos de preço variam. A mesma interface pode receber novos conectores autorizados sem alterar o ranking e os filtros.
