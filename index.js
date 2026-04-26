const cheerio = require('cheerio');

const infoList = [];

fetch('https://equal-love.jp/news/list/6')
    .then((response) => response.text())
    .then((html) => {
        const $ = cheerio.load(html);

        $('.infoList li').each((_, elem) => {
            const aTag = $(elem).find('a');

            const href = aTag.attr('href');

            const title = aTag.find('.tit').text().trim();

            const date = aTag.find('.date')
                .clone()              // ← span消すためにclone
                .children()
                .remove()
                .end()
                .text()
                .trim();

            if (title.includes('FC')) {
                infoList.push({
                    title,
                    date,
                    href: `https://equal-love.jp${href}`
                });
            }
        });

        console.log(infoList);
        return infoList;
    })
    .catch((error) => {
        console.error('エラー:', error);
    });