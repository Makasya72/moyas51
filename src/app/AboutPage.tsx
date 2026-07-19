import { Icon } from '../ui/Icon'

export function AboutPage() {
  return (
    <section className="page" aria-labelledby="about-title">
      <header className="page-header"><div><p className="eyebrow">Версия 1.0.0</p><h1 id="about-title">О приложении</h1><p>Простой локальный инструмент для личного учёта.</p></div></header>
      <div className="section-stack">
        <div className="card about-hero"><div className="brand-mark"><Icon name="timer" /></div><h2>Ваши смены остаются на вашем компьютере</h2><p>«Моя смена» работает локально, не требует регистрации и не передаёт историю, заработок или рабочие показатели на сервер.</p></div>
        <div className="about-grid">
          <div className="card about-card"><Icon name="info" /><h3>Неофициальный инструмент</h3><p>Это личный локальный трекер. Он не является официальным сервисом Яндекса и не заменяет внутреннюю систему учёта рабочего времени.</p></div>
          <div className="card about-card"><Icon name="calendar" /><h3>Локальное хранение</h3><p>Смены, настройки и финансы хранятся в IndexedDB текущего браузера. Для переноса используйте JSON-резервную копию.</p></div>
          <div className="card about-card"><Icon name="pip" /><h3>Мини-таймер</h3><p>Настоящий режим поверх программ доступен в настольных Chrome 116+, Edge 116+ и Firefox 151+ при наличии Document Picture-in-Picture.</p></div>
        </div>
        <div className="card card-pad">
          <div className="section-title"><h2>Честные ограничения</h2></div>
          <div className="settings-list">
            <div className="switch-row"><div className="switch-copy"><strong>Окно поверх программ</strong><span>Закроется вместе с основным сайтом, браузером или установленным PWA.</span></div><span className="status-pill">Локально</span></div>
            <div className="switch-row"><div className="switch-copy"><strong>Уведомления</strong><span>Гарантированы, пока приложение открыто; браузер может ограничить фоновые события после полного закрытия.</span></div><span className="status-pill">Браузер</span></div>
            <div className="switch-row"><div className="switch-copy"><strong>Данные</strong><span>Очистка данных сайта в браузере удалит IndexedDB. Сохраняйте резервные копии.</span></div><span className="status-pill status-pill--success">Приватно</span></div>
          </div>
        </div>
        <div className="privacy-banner"><Icon name="info" /><div><strong>Не сохраняйте персональные данные клиентов и содержимое обращений.</strong><br /><span>Приложение предназначено только для личных итоговых показателей.</span></div></div>
      </div>
    </section>
  )
}
