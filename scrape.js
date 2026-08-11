const { chromium } = require('playwright');
const fs = require('fs');


/*
==================================================
VAN AUTO — CHE168 SCRAPER
==================================================
*/


const LIST_PAGES = 10;


// Отбор по дате первой регистрации.
// Берём только 2020 год и новее.
const MIN_CAR_YEAR = 2020;


// Пока есть большой хвост машин без цены,
// добавляем новых медленнее.
const MAX_NEW_CARS_PER_RUN = 5;


// Главный приоритет:
// восстанавливаем цены уже сохранённым машинам.
const MAX_PRICE_RETRIES_PER_RUN = 25;


// Максимальный размер базы
const CATALOG_LIMIT = 500;



/*
==================================================
ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
==================================================
*/


function firstMatch(text, regex) {

  if (!text) {
    return null;
  }


  const match =
    text.match(regex);


  return match
    ? match[1].trim()
    : null;

}



function cleanName(value) {

  if (!value) {
    return null;
  }


  const parts =
    String(value)

      .replace(/\s+/g, ' ')

      .trim()

      .split(' ');


  /*
  Audi Audi Q3 -> Audi Q3
  BMW BMW X3 -> BMW X3
  */

  if (
    parts.length > 1 &&
    parts[0].toLowerCase() ===
    parts[1].toLowerCase()
  ) {

    parts.splice(
      1,
      1
    );

  }


  return parts.join(' ');

}



/*
==================================================
НОРМАЛИЗАЦИЯ
==================================================
*/


function normalizeFuel(value) {

  if (!value) {
    return null;
  }


  const v =
    String(value)
      .toLowerCase();


  if (
    v.includes('plug-in') ||
    v.includes('hybrid')
  ) {

    return 'Гибрид';

  }


  if (
    v.includes('electric')
  ) {

    return 'Электро';

  }


  if (
    v.includes('diesel')
  ) {

    return 'Дизель';

  }


  if (
    v.includes('gasoline')
  ) {

    return 'Бензин';

  }


  return value;

}



function normalizeTransmission(value) {

  if (!value) {
    return null;
  }


  const v =
    String(value)
      .toLowerCase();


  if (
    v.includes('dual-clutch') ||
    v.includes('dct') ||
    v.includes('dsg')
  ) {

    return 'Робот';

  }


  if (
    v.includes('cvt')
  ) {

    return 'Вариатор';

  }


  if (
    v.includes('automatic') ||
    v.includes('speed at')
  ) {

    return 'Автомат';

  }


  if (
    v.includes('manual')
  ) {

    return 'Механика';

  }


  return value;

}



function normalizeDrive(value) {

  if (!value) {
    return null;
  }


  const v =
    String(value)
      .toLowerCase();


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


  const v =
    String(value)
      .toLowerCase();


  if (
    v.includes('suv') ||
    v.includes('crossover')
  ) {

    return 'Кроссовер';

  }


  if (
    v.includes('sedan')
  ) {

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


  if (
    v.includes('coupe')
  ) {

    return 'Купе';

  }


  if (
    v.includes('pickup')
  ) {

    return 'Пикап';

  }


  return value;

}



/*
==================================================
ЧТЕНИЕ cars.json
==================================================
*/


function loadSavedCars() {

  if (
    !fs.existsSync(
      'cars.json'
    )
  ) {

    return [];

  }


  try {

    const data =
      JSON.parse(

        fs.readFileSync(
          'cars.json',
          'utf8'
        )

      );


    if (
      !Array.isArray(data)
    ) {

      return [];

    }


    /*
    Отбор строго по первой регистрации.
    Поле year уже формируется из registrationDate.
    */

    return data.filter(
      function (car) {

        const year =
          Number(car.year);


        return (
          Number.isFinite(year) &&
          year >= MIN_CAR_YEAR
        );

      }
    );

  }

  catch (error) {

    console.log(
      'Не удалось прочитать cars.json:',
      error.message
    );


    return [];

  }

}



/*
==================================================
ФОТО
==================================================
*/


function uniqueCarPhotos(rawImages) {

  const seen =
    new Set();


  const preferred = [];
  const fallback = [];


  for (
    const src
    of rawImages
  ) {

    if (
      !src ||
      !String(src).includes(
        'autoimg'
      )
    ) {

      continue;

    }


    let clean =
      String(src);


    try {

      const url =
        new URL(clean);


      url.search = '';


      clean =
        url.toString();

    }

    catch (_) {}


    if (
      seen.has(clean)
    ) {

      continue;

    }


    seen.add(clean);


    if (
      clean.includes(
        '1400x0_'
      )
    ) {

      preferred.push(clean);

    }

    else {

      fallback.push(clean);

    }

  }


  const result =

    preferred.length >= 3

      ? preferred

      : preferred.concat(
          fallback
        );


  return result.slice(
    0,
    20
  );

}



/*
==================================================
ПОИСК ID АВТОМОБИЛЕЙ
==================================================
*/


async function discoverCarIds(
  browser
) {

  console.log(
    '\n===== ПОИСК НОВЫХ ОБЪЯВЛЕНИЙ =====\n'
  );


  const context =
    await browser.newContext({

      locale:
        'en-US',

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


  const ids = [];

  const seen =
    new Set();


  for (
    let pageNumber = 1;
    pageNumber <= LIST_PAGES;
    pageNumber++
  ) {

    const url =

      'https://global.che168.com/en/used-cars' +
      `?sort=4&page=${pageNumber}`;


    try {

      console.log(
        `Список CHE168: страница ${pageNumber}/${LIST_PAGES}`
      );


      await page.goto(
        url,
        {

          waitUntil:
            'domcontentloaded',

          timeout:
            45000

        }
      );


      await page.waitForTimeout(
        2500
      );


      const hrefs =
        await page

          .locator(
            'a[href*="/en/detail/"]'
          )

          .evaluateAll(

            links =>
              links.map(
                link =>

                  link.href ||

                  link.getAttribute(
                    'href'
                  ) ||

                  ''

              )

          );


      for (
        const href
        of hrefs
      ) {

        const match =
          String(href)
            .match(
              /\/en\/detail\/(\d+)/
            );


        if (!match) {
          continue;
        }


        const id =
          match[1];


        if (
          seen.has(id)
        ) {
          continue;
        }


        seen.add(id);

        ids.push(id);

      }


      console.log(
        `Уникальных ID найдено: ${ids.length}`
      );

    }

    catch (error) {

      console.log(

        `Страница списка ${pageNumber} не загрузилась:`,

        error.message

      );

    }

  }


  await context.close();


  console.log(
    `\nВсего найдено ID: ${ids.length}\n`
  );


  return ids;

}



/*
==================================================
GLOBAL CHE168
ХАРАКТЕРИСТИКИ
==================================================
*/


async function scrapeGlobalCar(
  browser,
  id
) {

  const url =
    `https://global.che168.com/en/detail/${id}`;


  let lastError =
    null;


  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {

    const context =
      await browser.newContext({

        locale:
          'en-US',

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

          waitUntil:
            'domcontentloaded',

          timeout:
            45000

        }
      );


      await page.waitForTimeout(
        3500
      );


      const text =
        await page

          .locator(
            'body'
          )

          .innerText({

            timeout:
              15000

          });


      if (
        !text ||
        text.length < 500
      ) {

        throw new Error(
          'страница содержит слишком мало данных'
        );

      }



      /*
      НАЗВАНИЕ
      */

      let name =
        null;


      try {

        const h1 =
          page

            .locator(
              'h1'
            )

            .first();


        if (
          await h1.count()
        ) {

          name =
            (
              await h1.innerText()
            ).trim();

        }

      }

      catch (_) {}


      name =
        cleanName(name);



      /*
      ДАТА ПЕРВОЙ РЕГИСТРАЦИИ
      */

      const registrationDate =
        firstMatch(

          text,

          /1st Reg\. Date\s+(\d{4}\.\d{2})/i

        );


      /*
      Год каталога берём ТОЛЬКО
      из даты первой регистрации.
      */

      const year =

        registrationDate

          ? Number(
              registrationDate.slice(
                0,
                4
              )
            )

          : null;



      /*
      ПРОБЕГ
      */

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



      /*
      ДВИГАТЕЛЬ / МОЩНОСТЬ
      */

      const engineMatch =
        text.match(

          /Engine \(cc\)\s*([0-9.]+[TL]?)\s*(\d+)\s*(?:HP|PS)/i

        );


      let engine =
        null;


      let engineVolume =
        null;


      let engineVolumeCc =
        null;


      let power =
        null;


      if (
        engineMatch
      ) {

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


        if (
          volumeMatch
        ) {

          engineVolume =
            Number(
              volumeMatch[1]
            );


          engineVolumeCc =
            Math.round(

              engineVolume *
              1000

            );

        }

      }



      /*
      ТОПЛИВО
      */

      const fuelRaw =
        firstMatch(

          text,

          /Fuel Type\s*([^\n]+)/i

        );



      /*
      КОРОБКА
      */

      const transmissionRaw =
        firstMatch(

          text,

          /Trans\.\s*([^\n]+)/i

        );



      /*
      ПРИВОД
      */

      const driveRaw =
        firstMatch(

          text,

          /Drive Train\s*([^\n]+)/i

        );



      /*
      КУЗОВ
      */

      const bodyRaw =
        firstMatch(

          text,

          /Body Type\s*([^\n]+)/i

        );



      /*
      ФОТО
      */

      const rawImages =
        await page

          .locator(
            'img'
          )

          .evaluateAll(

            images =>
              images.map(

                img =>

                  img.currentSrc ||

                  img.src ||

                  img.dataset.src ||

                  img.dataset.original ||

                  ''

              )

          );


      const photos =
        uniqueCarPhotos(
          rawImages
        );


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


        /*
        Поле только для фильтра сайта.
        Машины мощнее 160 л.с.
        всё равно сохраняются.
        */

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
          photos[0] ||
          null,


        photosCount:
          photos.length,


        photos

      };

    }

    catch (error) {

      lastError =
        error;


      console.log(

        `GLOBAL ${id}:`,

        error.message

      );


      try {

        await context.close();

      }

      catch (_) {}


      if (
        attempt < 2
      ) {

        await new Promise(

          resolve =>
            setTimeout(
              resolve,
              2500
            )

        );

      }

    }

  }


  throw lastError;

}



/*
==================================================
КИТАЙСКИЙ CHE168
ЦЕНА В CNY
==================================================
*/


async function scrapeChinaPrice(
  browser,
  id
) {

  const url =

    'https://pcm.che168.com/2023/cardetail_rn/index' +
    `?infoid=${id}&pvareaid=108991`;


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

          waitUntil:
            'commit',

          timeout:
            20000

        }
      );


      await page.waitForTimeout(
        6500
      );


      const text =
        await page

          .locator(
            'body'
          )

          .innerText({

            timeout:
              9000

          });


      /*
      Основная цена CHE168
      находится перед:
      新车含税价
      */

      const priceMatch =
        text.match(

          /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*\n?\s*万\s*\n?\s*新车含税价/

        );


      if (
        priceMatch
      ) {

        const priceWan =
          Number(
            priceMatch[1]
          );


        const priceCny =
          Math.round(

            priceWan *
            10000

          );


        console.log(
          `PRICE ${id}: ${priceCny} ¥`
        );


        await context.close();


        return {

          priceCny,

          priceWan,

          priceSource:
            'CHE168 live',

          priceUpdatedAt:
            new Date()
              .toISOString(),

          chinaUrl:
            url

        };

      }


      console.log(
        `PRICE ${id}: цена не найдена (${strategy.name})`
      );

    }

    catch (error) {

      console.log(

        `PRICE ${id} ${strategy.name}:`,

        error.message

      );

    }


    try {

      await context.close();

    }

    catch (_) {}

  }


  return {

    priceCny:
      null,

    priceWan:
      null,

    priceSource:
      null,

    priceUpdatedAt:
      null,

    chinaUrl:
      url

  };

}



/*
==================================================
ОСНОВНОЙ ЗАПУСК
==================================================
*/


(async () => {


  /*
  1. ЧИТАЕМ СУЩЕСТВУЮЩУЮ БАЗУ
  */

  const savedCars =
    loadSavedCars();


  console.log(
    '\n===== СУЩЕСТВУЮЩАЯ БАЗА ====='
  );


  console.log(
    `Автомобилей 2020+: ${savedCars.length}`
  );


  const carsById =
    new Map(

      savedCars.map(

        car => [

          String(
            car.id
          ),

          car

        ]

      )

    );



  /*
  2. ЗАПУСКАЕМ БРАУЗЕР
  */

  const browser =
    await chromium.launch({

      headless:
        true

    });



  try {


    /*
    ==============================================
    3. СНАЧАЛА ВОССТАНАВЛИВАЕМ ЦЕНЫ
    ==============================================
    */


    const carsWithoutPrice =
      savedCars.filter(
        function (car) {

          return (
            car.priceCny === null ||
            car.priceCny === undefined
          );

        }
      );


    const retryPriceIds =
      carsWithoutPrice

        .map(
          car =>
            String(
              car.id
            )
        )

        .slice(
          0,
          MAX_PRICE_RETRIES_PER_RUN
        );


    console.log(
      '\n===== ВОССТАНОВЛЕНИЕ ЦЕН ====='
    );


    console.log(
      'Всего машин без цены:',
      carsWithoutPrice.length
    );


    console.log(
      'Попробуем в этом запуске:',
      retryPriceIds.length
    );


    let restoredPricesCount =
      0;


    for (
      const id
      of retryPriceIds
    ) {

      console.log(

        `\n===== ПОВТОР ЦЕНЫ ${id} =====`

      );


      const previous =
        carsById.get(
          String(id)
        );


      if (!previous) {
        continue;
      }


      /*
      Защита по первой регистрации 2020+
      */

      if (
        !previous.year ||
        Number(previous.year) <
        MIN_CAR_YEAR
      ) {

        carsById.delete(
          String(id)
        );

        continue;
      }


      const livePrice =
        await scrapeChinaPrice(

          browser,

          id

        );


      if (
        livePrice.priceCny === null
      ) {

        console.log(
          `PRICE ${id}: пока не удалось восстановить`
        );

        continue;
      }


      carsById.set(

        String(id),

        {

          ...previous,

          chinaUrl:
            livePrice.chinaUrl,

          priceWan:
            livePrice.priceWan,

          priceCny:
            livePrice.priceCny,

          priceSource:
            livePrice.priceSource,

          priceUpdatedAt:
            livePrice.priceUpdatedAt

        }

      );


      restoredPricesCount++;


      console.log(
        `PRICE ${id}: ВОССТАНОВЛЕНА`
      );

    }



    /*
    ==============================================
    4. ТЕПЕРЬ ИЩЕМ НОВЫЕ МАШИНЫ
    ==============================================
    */


    const discoveredIds =
      await discoverCarIds(
        browser
      );


    const candidateIds =
      discoveredIds

        .filter(

          id =>
            !carsById.has(
              String(id)
            )

        )

        /*
        Берём больше кандидатов,
        потому что часть окажется
        зарегистрирована до 2020.
        */

        .slice(
          0,
          Math.min(
            MAX_NEW_CARS_PER_RUN * 4,
            discoveredIds.length
          )
        );


    console.log(
      '\n===== НОВЫЕ МАШИНЫ ====='
    );


    console.log(
      'Найдено ID:',
      discoveredIds.length
    );


    console.log(
      'Кандидатов:',
      candidateIds.length
    );


    console.log(
      'Добавим максимум:',
      MAX_NEW_CARS_PER_RUN
    );



    /*
    ==============================================
    5. ДОБАВЛЯЕМ НОВЫЕ
    ==============================================
    */


    let addedCount =
      0;


    for (
      const id
      of candidateIds
    ) {


      if (
        addedCount >=
        MAX_NEW_CARS_PER_RUN
      ) {
        break;
      }


      if (
        carsById.size >=
        CATALOG_LIMIT
      ) {

        console.log(
          'Достигнут лимит каталога.'
        );

        break;

      }


      console.log(

        `\n===== НОВАЯ МАШИНА ${id} =====`

      );


      try {


        /*
        Сначала характеристики.
        */

        const details =
          await scrapeGlobalCar(

            browser,

            id

          );


        /*
        ФИЛЬТР:
        только дата первой регистрации 2020+
        */

        if (
          !details.registrationDate ||
          !details.year ||
          Number(details.year) <
          MIN_CAR_YEAR
        ) {

          console.log(

            `ПРОПУСК ${id}: первая регистрация ${
              details.registrationDate ||
              'не определена'
            }`

          );


          continue;

        }


        /*
        Затем цена.
        */

        const livePrice =
          await scrapeChinaPrice(

            browser,

            id

          );


        const now =
          new Date()
            .toISOString();


        const car = {

          ...details,


          chinaUrl:
            livePrice.chinaUrl,


          priceWan:
            livePrice.priceWan,


          priceCny:
            livePrice.priceCny,


          priceSource:
            livePrice.priceSource,


          priceUpdatedAt:
            livePrice.priceUpdatedAt,


          addedAt:
            now,


          lastSeenAt:
            now,


          status:
            'active'

        };


        carsById.set(

          String(id),

          car

        );


        addedCount++;


        console.log(

          `ДОБАВЛЕНО ${id}. ` +
          `Новых в этом запуске: ${addedCount}`

        );

      }

      catch (error) {

        console.log(

          `Машина ${id} пропущена:`,

          error.message

        );

      }

    }



    /*
    ==============================================
    6. ФИНАЛЬНАЯ ОЧИСТКА
    ==============================================
    */


    const result =
      Array.from(
        carsById.values()
      )

        .filter(
          function (car) {

            const year =
              Number(
                car.year
              );


            return (
              car.registrationDate &&
              Number.isFinite(year) &&
              year >= MIN_CAR_YEAR
            );

          }
        )

        .slice(
          0,
          CATALOG_LIMIT
        );



    /*
    ==============================================
    7. СТАТИСТИКА ЦЕН
    ==============================================
    */


    const withPrice =
      result.filter(
        car =>
          Number(car.priceCny) > 0
      ).length;


    const withoutPrice =
      result.length -
      withPrice;



    /*
    ==============================================
    8. СОХРАНЯЕМ cars.json
    ==============================================
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



    /*
    ==============================================
    ФИНАЛЬНЫЙ ЛОГ
    ==============================================
    */


    console.log(
      '\n================================'
    );


    console.log(
      'VAN AUTO — CHE168 ГОТОВО'
    );


    console.log(
      `Восстановлено цен: ${restoredPricesCount}`
    );


    console.log(
      `Добавлено новых: ${addedCount}`
    );


    console.log(
      `Всего машин 2020+: ${result.length}`
    );


    console.log(
      `С ценой CHE168: ${withPrice}`
    );


    console.log(
      `Без цены CHE168: ${withoutPrice}`
    );


    console.log(
      `Лимит базы: ${CATALOG_LIMIT}`
    );


    console.log(
      '================================\n'
    );

  }

  finally {

    await browser.close();

  }


})();
