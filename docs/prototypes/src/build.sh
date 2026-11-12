#!/bin/sh
cd "$(dirname "$0")"
{ cat c1v4.html o0-onboard.html boot.html c0-body.html; echo '<script>'; echo '(() => {'; cat c0-config.js c2-map.js c3-art.js c4-store4.js c5-parts3.js c6-screens4.js o-onboard.js s-profile.js c8-onboard.js c7-sheets4.js; echo '})();'; echo '</script>'; } > ../customer.html
wc -c ../customer.html
