# aeroCRM для Android

Подписанное приложение TWA открывает только `https://workspace.aerocrm.space/inbox`.
Package ID: `space.aerocrm.workspace`. Минимум: Android 10 (API 29), актуальный Chrome
либо другой браузер с поддержкой TWA. Лендинг и сервисная админка в APK не включены.
Внешние сайты и OAuth открываются с интерфейсом браузера; доверенный origin только один.

Проект создан Bubblewrap 1.25.0 из утверждённых иконок aeroCRM. Зависимость
Android Browser Helper зафиксирована на 2.6.2, AndroidX Browser на стабильной 1.9.0,
AGP на 8.10.1; Gradle 8.11.1 проверяется по SHA-256.
Изменения поверх генератора: ограничение launch URL, private signing через env,
отключённый Android backup, HTTPS, Maven Central и compile SDK 36 / target SDK 35.
Не запускайте `bubblewrap update` без проверки этих изменений.

## Сборка обновления

Нужны Node.js 22, JDK 17, Android SDK platform 36 / build-tools 35.0.0. Укажите
`JAVA_HOME` и `ANDROID_HOME` либо используйте локальный
`../../.private/android/bubblewrap-config.json`. Выполните из каталога проекта:

```sh
node scripts/build-release.mjs
```

Скрипт берёт существующий ключ `../../.private/android/aerocrm-release.keystore`
и пароль из macOS Keychain (service `space.aerocrm.workspace.signing`, account
`aerocrm-android-release`). На другой машине задайте `AEROCRM_ANDROID_KEYSTORE`,
`AEROCRM_ANDROID_STORE_PASSWORD` и при необходимости `AEROCRM_ANDROID_KEY_PASSWORD`
через приватное окружение. Секреты не передаются в аргументах Gradle.

Результат после проверки подписи, сертификата и zipalign: `../../aeroCRM.apk`, вне Git.
Перед обновлением увеличьте `appVersionCode` и версию в `twa-manifest.json` и
`app/build.gradle`. Сохраните package ID и signing key, иначе Android не установит
обновление поверх существующего приложения.

## Публикация и связь с доменом

Публичный сертификат опубликован в CRM `public/.well-known/assetlinks.json`.
Приватный ключ, пароли и резервный комплект в репозитории отсутствуют.
После выкладки проверяйте HTTPS 200 без перенаправления, JSON Content-Type и
совпадение SHA-256 сертификата APK с Digital Asset Links.

APK размещается отдельным объектом `content-files/aerocrm/android/<version>/aeroCRM.apk`.
После проверки скачивания обновляются фактические метаданные
`../aeroCRM_frontends/brand/android-release.json`. Публикация в Google Play — отдельная задача.

## Проверки релиза

Проверяйте вход и возврат OAuth на workspace origin, повторный запуск и сессию,
Android Back, внешние ссылки, выбор/скачивание файлов, отсутствие сети и обновление
APK. Service Worker сохраняет только нейтральный offline.html; CRM страницы,
приватные API, вложения и ответы авторизации не сохраняются в Cache Storage.
Первый запуск без сети требует предварительной загрузки приложения онлайн.
