const { chromium } = require('playwright');
const fs = require('fs');


/*
==================================================
VAN AUTO — CHE168 SCRAPER

Пока тестируем на одной машине.
Позже сюда автоматически пойдёт список ID.
==================================================
*/

const CAR_IDS = [
  '59231822'
];


/*
Последняя цена, которую мы УЖЕ реально получили
с китайской страницы CHE168 в успешном тесте.

Нужна только для первого запуска, если CHE168
снова временно не отдаст китайскую страницу.
После появления cars.json данные будут
сохраняться между запусками автоматически.
*/

const BOOTSTRAP_PRICES = {
  '59231822': 185000
};



/* ==================================================
   ОБЩИЕ ФУНКЦИИ
   ================================================== */

function firstMatch(text, regex) {

  if (!text) {
    return null;
  }

  const match = text.match(regex);

  return match
    ? match[1].trim()
    : null;
}


function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function loadSavedCars() {

  if (!fs.existsSync('cars.json')) {
    return [];
  }

  try {

    const data = JSON.parse(
      fs.readFileSync(
        'cars.json',
        'utf8'
      )
    );

    return Array.isArray(data)
      ? data
      : [];

  } catch (error) {

    console.log(
      'Не удалось прочитать старый cars.json:',
      error.message
    );

    return [];
  }
}



/* ==================================================
   НОРМАЛИЗАЦИЯ
   ================================================== */

function normalizeFuel(value) {

  if (!value) {
    return null;
  }

  const v = value.toLowerCase();

  if (v.includes('gasoline')) {
    return 'Бензин';
  }

  if (v.includes('diesel')) {
    return 'Дизель';
  }

  if (
    v.includes('plug-in') ||
    v.includes('hybrid')
  ) {
    return 'Гибрид';
  }

  if (v.includes('electric')) {
    return 'Электро';
  }

  return value;
}


function normalizeTransmission(value) {

  if (!value) {
    return null;
  }

  const v = value.toLowerCase();

  if (
    v.includes('dual-clutch') ||
    v.includes('dct') ||
    v.includes('dsg')
  ) {
    return 'Робот';
  }

  if (v.includes('cvt')) {
    return 'Вариатор';
  }

  if (
    v.includes('automatic') ||
    v.includes('speed at')
  ) {
    return 'Автомат';
  }

  if (v.includes('manual')) {
    return 'Механика';
  }

  return value;
}


function normalizeDrive(value) {

  if (!value) {
    return null;
  }

  const v = value.toLowerCase();

  if (
    v.includes('front-wheel') ||
    v.includes('fwd')
  ) {
    return 'Передний';
  }

  if (
    v.includes('rear-wheel') ||
    v.includes('rwd')
  ) {
    return 'Задний';
  }

  if (
    v.includes('all-wheel') ||
    v.includes('awd') ||
    v.includes('four-wheel') ||
    v.includes('4wd')
  ) {
    return 'Полный';
  }

  return value;
}


function normalizeBody(value) {

  if (!value) {
    return null;
  }

  const v = value.toLowerCase();

  if (
    v.includes('suv') ||
    v.includes('crossover')
  ) {
    return 'Кроссовер';
  }

  if (v.includes('sedan')) {
    return 'Седан';
  }

  if (
    v.includes('mpv') ||
    v.includes('minivan')
  ) {
    return 'Минивэн';
  }

  if (
    v.includes('hatchback') ||
    v.includes('hatch')
  ) {
    return 'Хэтчбек';
  }

  if (
    v.includes('wagon') ||
    v.includes('estate')
  ) {
    return 'Универсал';
  }

  if (v.includes('coupe')) {
    return 'Купе';
  }

  return value;
}



/* ==================================================
   GLOBAL.CHE168
   ХАРАКТЕРИСТИКИ + МОЩНОСТЬ + ФОТО
   ================================================== */

async function scrapeGlobalCar(browser, id) {

  const url =
    `https://global.che168.com/en/detail/${id}`;


  let lastError = null;


  for (let attempt = 1; attempt <= 2; attempt++) {

    const context =
      await browser.newContext({

        locale: 'en-US',

        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0.0.0 Safari/537.36',

        viewport: {
          width: 1440,
          height: 1200
        }

      });


    const page =
      await context.newPage();


    try {

      console.log(
        `GLOBAL ${id}: попытка ${attempt}`
      );


      await page.goto(
        url,
        {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        }
      );


      await page.waitForTimeout(
        4000
      );


      const text =
        await page
          .locator('body')
          .innerText({
            timeout: 15000
          });


      if (
        !text ||
        text.length < 500
      ) {

        throw new Error(
          'Global CHE168 вернул слишком мало данных'
        );
      }


      /* ------------------------------
         НАЗВАНИЕ
         ------------------------------ */

      let name = null;


      try {

        const h1 =
          page.locator('h1').first();

        if (
          await h1.count()
        ) {

          name =
            (
              await h1.innerText()
            ).trim();

        }

      } catch (_) {}


      if (!name) {

        name =
          firstMatch(
            text,
            /#?\s*(Audi[^\n]+)/i
          );

      }


      /* ------------------------------
         РЕГИСТРАЦИЯ
         ------------------------------ */

      const registrationDate =
        firstMatch(
          text,
          /1st Reg\. Date\s+(\d{4}\.\d{2})/i
        );


      const year =
        registrationDate
          ? Number(
              registrationDate.slice(0, 4)
            )
          : null;


      /* ------------------------------
         ПРОБЕГ
         ------------------------------ */

      const mileageRaw =
        firstMatch(
          text,
          /Mileage \(km\)\s*([\d,]+)/i
        );


      const mileage =
        mileageRaw
          ? Number(
              mileageRaw.replace(
                /,/g,
                ''
              )
            )
          : null;


      /* ------------------------------
         ДВИГАТЕЛЬ + МОЩНОСТЬ

         Например:
         1.4T 150HP L4
         ------------------------------ */

      const engineMatch =
        text.match(
          /Engine \(cc\)\s*([0-9.]+[TL]?)\s*(\d+)\s*HP/i
        );


      let engine = null;
      let engineVolume = null;
      let engineVolumeCc = null;
      let power = null;


      if (engineMatch) {

        engine =
          engineMatch[1];

        power =
          Number(
            engineMatch[2]
          );


        const volumeMatch =
          engine.match(
            /([0-9.]+)/
          );


        if (volumeMatch) {

          engineVolume =
            Number(
              volumeMatch[1]
            );


          engineVolumeCc =
            Math.round(
              engineVolume * 1000
            );

        }

      }


      /* ------------------------------
         ТОПЛИВО
         ------------------------------ */

      const fuelRaw =
        firstMatch(
          text,
          /Fuel Type\s*([^\n]+)/i
        );


      /* ------------------------------
         КОРОБКА
         ------------------------------ */

      const transmissionRaw =
        firstMatch(
          text,
          /Trans\.\s*([^\n]+)/i
        );


      /* ------------------------------
         ПРИВОД
         ------------------------------ */

      const driveRaw =
        firstMatch(
          text,
          /Drive Train\s*([^\n]+)/i
        );


      /* ------------------------------
         КУЗОВ
         ------------------------------ */

      const bodyRaw =
        firstMatch(
          text,
          /Body Type\s*([^\n]+)/i
        );


      /* ------------------------------
         ФОТО
         ------------------------------ */

      const rawImages =
        await page
          .locator('img')
          .evaluateAll(
            images =>
              images.map(
                img =>
                  img.currentSrc ||
                  img.src ||
                  img.dataset.src ||
                  ''
              )
          );


      const photos = [

        ...new Set(

          rawImages

            .filter(Boolean)

            .filter(
              src =>
                src.includes(
                  'autoimg'
                )
            )

        )

      ];


      await context.close();


      return {

        id,

        country:
          'Китай',

        source:
          'CHE168',

        globalUrl:
          url,

        name,

        registrationDate,

        year,

        mileage,

        engine,

        engineVolume,

        engineVolumeCc,

        power,

        preferentialPower:

          power !== null
            ? power <= 159
            : null,

        transmission:
          normalizeTransmission(
            transmissionRaw
          ),

        drive:
          normalizeDrive(
            driveRaw
          ),

        fuel:
          normalizeFuel(
            fuelRaw
          ),

        body:
          normalizeBody(
            bodyRaw
          ),

        photo:
          photos[0] || null,

        photosCount:
          photos.length,

        photos:
          photos.slice(0, 20)

      };


    } catch (error) {

      lastError = error;


      console.log(
        `GLOBAL ${id}: ${error.message}`
      );


      await context.close();


      if (attempt < 2) {

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              3000
            )
        );

      }

    }

  }


  throw lastError;
}



/* ==================================================
   КИТАЙСКИЙ CHE168
   ТОЛЬКО ЦЕНА В ЮАНЯХ
   ================================================== */

async function scrapeChinaPrice(
  browser,
  id
) {

  const url =
    `https://pcm.che168.com/2023/cardetail_rn/index?infoid=${id}&pvareaid=108991`;


  const strategies = [

    {

      name:
        'desktop',

      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/126.0.0.0 Safari/537.36',

      viewport: {
        width: 1440,
        height: 1200
      }

    },


    {

      name:
        'mobile',

      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
        'Version/17.5 Mobile/15E148 Safari/604.1',

      viewport: {
        width: 390,
        height: 844
      }

    }

  ];


  for (
    const strategy
    of strategies
  ) {

    const context =
      await browser.newContext({

        locale:
          'zh-CN',

        timezoneId:
          'Asia/Shanghai',

        userAgent:
          strategy.userAgent,

        viewport:
          strategy.viewport,

        extraHTTPHeaders: {

          'Accept-Language':
            'zh-CN,zh;q=0.9',

          'Referer':
            'https://www.che168.com/'

        }

      });


    const page =
      await context.newPage();


    try {

      console.log(
        `PRICE ${id}: ${strategy.name}`
      );


      await page.goto(
        url,
        {
          waitUntil: 'commit',
          timeout: 22000
        }
      );


      await page.waitForTimeout(
        7000
      );


      const text =
        await page
          .locator('body')
          .innerText({
            timeout: 10000
          });


      const priceMatch =
        text.match(
          /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/
        );


      if (priceMatch) {

        const priceWan =
          Number(
            priceMatch[1]
          );


        const priceCny =
          Math.round(
            priceWan * 10000
          );


        console.log(
          `PRICE ${id}: ${priceCny} ¥`
        );


        await context.close();


        return {

          priceCny,

          priceWan,

          strategy:
            strategy.name,

          chinaUrl:
            url

        };

      }


      console.log(
        `PRICE ${id}: цена не найдена`
      );


    } catch (error) {

      console.log(
        `PRICE ${id} ${strategy.name}: ${error.message}`
      );

    }


    await context.close();

  }


  return {

    priceCny:
      null,

    priceWan:
      null,

    strategy:
      null,

    chinaUrl:
      url

  };
}



/* ==================================================
   ЗАПУСК
   ================================================== */

(async () => {

  const savedCars =
    loadSavedCars();


  const savedById =
    new Map(
      savedCars.map(
        car => [
          String(car.id),
          car
        ]
      )
    );


  const browser =
    await chromium.launch({
      headless: true
    });


  const result = [];


  for (
    const id
    of CAR_IDS
  ) {

    console.log(
      '\n================================'
    );

    console.log(
      `АВТОМОБИЛЬ ${id}`
    );

    console.log(
      '================================\n'
    );


    const previous =
      savedById.get(
        String(id)
      ) || null;


    let details = null;


    try {

      details =
        await scrapeGlobalCar(
          browser,
          id
        );


    } catch (error) {

      console.log(
        `Не удалось получить характеристики ${id}:`,
        error.message
      );


      /*
      Если сегодня CHE168 полностью лежит,
      не удаляем автомобиль из нашей базы.
      */

      if (previous) {

        console.log(
          'Сохраняем предыдущую версию автомобиля.'
        );

        result.push(
          previous
        );

        continue;

      }


      console.log(
        'Предыдущей версии нет — пропускаем.'
      );

      continue;

    }


    /*
    -----------------------------------
    ПЫТАЕМСЯ ПОЛУЧИТЬ НОВУЮ ЦЕНУ
    -----------------------------------
    */

    const livePrice =
      await scrapeChinaPrice(
        browser,
        id
      );


    /*
    -----------------------------------
    ВЫБИРАЕМ ЦЕНУ

    Приоритет:
    1. новая цена CHE168
    2. сохранённая цена cars.json
    3. последний успешный тест
    -----------------------------------
    */

    let priceCny = null;

    let priceSource = null;

    let priceUpdatedAt =
      previous?.priceUpdatedAt || null;


    if (
      livePrice.priceCny !== null
    ) {

      priceCny =
        livePrice.priceCny;

      priceSource =
        'CHE168 live';


      /*
      Дату меняем только если цена
      реально изменилась или её раньше не было.
      */

      if (
        !previous ||
        previous.priceCny !== priceCny
      ) {

        priceUpdatedAt =
          new Date().toISOString();

      }

    }

    else if (
      previous &&
      previous.priceCny !== null &&
      previous.priceCny !== undefined
    ) {

      priceCny =
        previous.priceCny;

      priceSource =
        'saved';

    }

    else if (
      BOOTSTRAP_PRICES[id]
    ) {

      priceCny =
        BOOTSTRAP_PRICES[id];

      priceSource =
        'last successful test';

    }


    const priceWan =
      priceCny !== null
        ? priceCny / 10000
        : null;


    /*
    Сохраняем предыдущие дополнительные поля,
    но свежие характеристики имеют приоритет.
    */

    const car = {

      ...(previous || {}),

      ...details,

      chinaUrl:
        livePrice.chinaUrl,

      priceWan,

      priceCny,

      priceSource,

      priceUpdatedAt

    };


    result.push(
      car
    );


    console.log(
      '\nГОТОВЫЙ АВТОМОБИЛЬ:\n'
    );


    console.log(
      JSON.stringify(
        car,
        null,
        2
      )
    );

  }


  await browser.close();


  /*
  ==========================================
  СОХРАНЯЕМ БАЗУ
  ==========================================
  */

  fs.writeFileSync(

    'cars.json',

    JSON.stringify(
      result,
      null,
      2
    ) + '\n',

    'utf8'

  );


  console.log(
    '\n================================'
  );

  console.log(
    `cars.json сохранён. Машин: ${result.length}`
  );

  console.log(
    '================================\n'
  );

})();
