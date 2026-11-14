// O nome vem de PRODUCT_NAME no .env da raiz (injetado pelo Vite no build). Não escreva o nome no código.
export const PRODUCT_NAME = import.meta.env.PRODUCT_NAME;
if (!PRODUCT_NAME) throw new Error('PRODUCT_NAME não definido no .env');
