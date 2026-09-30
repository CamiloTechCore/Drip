import type { Config } from 'tailwindcss';
export default { content: ['./index.html','./src/**/*.{ts,tsx}'], theme: { extend: { colors: { ink:'#202336', muted:'#717586', canvas:'#F7F8FA', primary:'#5551E8', mint:'#138465' }, borderRadius: { card:'24px' }, fontFamily: { sans:['Inter','-apple-system','BlinkMacSystemFont','sans-serif'] } } }, plugins:[] } satisfies Config;
