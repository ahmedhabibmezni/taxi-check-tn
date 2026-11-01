import { languages, selectLanguage, useLanguage } from '../localization';

export function LanguageSelector() {
  const language = useLanguage();
  return <label className="language-selector">
    <span lang="aeb-TN">اللغة</span><span aria-hidden="true"> / </span><span lang="en">Language</span>
    <select value={language} onChange={event => {
      const choice = event.target.value;
      if (choice === 'aeb' || choice === 'ar' || choice === 'fr' || choice === 'en') selectLanguage(choice);
    }}>
      {Object.entries(languages).map(([id, info]) => <option key={id} value={id} lang={info.lang} dir={info.dir}>{info.label}</option>)}
    </select>
  </label>;
}
