const { chromium } = require('playwright');
const fs = require('fs');

(async () => {

  const url =
    'https://pcm.che168.com/2023/cardetail_rn/index?infoid=59231822&pvareaid=108991';

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    locale: 'zh-CN',

    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/126.0.0.0 Safari/537.36',

    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const page = await context.newPage();


  console.log('Открываем CHE168...');


  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });


  /*
    Даём JavaScript страницы время
    загрузить реальные данные автомобиля
  */

  await page.waitForTimeout(10000);


  const title = await page.title();

  const finalUrl = page.url();


  let text = '';

  try {

    text = await page.locator('body').innerText();

  } catch (error) {

    text = '';

  }


  const html = await page.content();


  /*
    Сохраняем всё для диагностики
  */

  fs.writeFileSync(
    'che168.html',
    html,
    'utf8'
  );


  await page.screenshot({
    path: 'che168.png',
    fullPage: true
  });


  /*
    Ищем китайские цены вида:
    21.58万
  */

  const matches =
    [...text.matchAll(/(\d+(?:\.\d+)?)\s*万/g)]
      .map(match => match[1]);


  const wanValues =
    [...new Set(matches)];


  const result = {

    title: title,

    finalUrl: finalUrl,

    textLength: text.length,

    htmlLength: html.length,

    contains21_58:
      text.includes('21.58') ||
      html.includes('21.58'),

    containsWan:
      text.includes('万') ||
      html.includes('万'),

    wanValues:
      wanValues.slice(0, 30),

    firstText:
      text.slice(0, 1500)

  };


  console.log('\n===== РЕЗУЛЬТАТ CHE168 =====\n');

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );


  await browser.close();

})();
