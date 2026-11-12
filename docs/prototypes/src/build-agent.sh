#!/bin/sh
cd "$(dirname "$0")"
{ sed -e 's#<title>Jiffo</title>#<title>Jiffo Agent</title>#' -e '/<link rel="icon"/d' c1v4.html | sed '1a <link rel="icon" href="'"$(cat favicon-agent.txt)"'">'; cat o0-onboard.html a1-extra.html boot.html a0-body.html; echo '<script>'; echo '(() => {'; cat c0-config.js c2-map.js c3-art.js a4-store.js a5-ui.js o-onboard.js s-profile.js a7-onboard.js a6-tabs.js; echo '})();'; echo '</script>'; } > ../agent.html
wc -c ../agent.html
