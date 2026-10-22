import './globals.css';

export const metadata = { title: '노래 예약', icons: { icon: '/logo.png' } };
export const viewport = { themeColor: '#FFFFFF' };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        {/* 경영지원실 허브와 같은 폰트·사내 공통 스타일 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
        <link rel="stylesheet" href="https://titan-ui-cqu.pages.dev/v1/titan-ui.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
