'use strict';
exports.getPrimeDate = (req, res, next) => {
  var date = new Date('2/2/2016');
  var day = date.getDay();
  let i, flag = 0;

    for (i = 2; i <= day / 2; ++i) {
        if (day % i == 0) {
            flag = 1;
            break;
        }
    }
    if (day == 1) {
        res.send('date is prime');
        return next();
    }
    else {
        if (flag == 0) {
          res.send('date is prime');
          return next();
        }
        else{
          res.send('date is not prime');
          return next();
        }
    }


}
