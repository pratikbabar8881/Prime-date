'use strict';
const posmain = require('../../../storage/posmain/models');
const db = require('../../../storage/orders/models');
const b2bdb = require('../../../storage/b2b/models');
const _ = require('lodash');
const logger = require('../../config/environment').logger.get('FactoryOutlet');
const crypto = require('crypto');
const Joi = require('joi');
const FactoryOutletOrder = {
  tags: ['factoryoutlet']
};
const factoryOutletAdmin = 'factoryoutlet.B2B@firstcry.com';
const restify = require('restify');
const request = require('request');
const bulkEmails = require('../../config/environment').mailer;
const posCredential = require('../../config/environment').posCredential;
const factoryOutletConfig = require('../../config/environment').factoryOutlet;
const config = require('../../config/environment');
const mailer = require('../../mailer');
const moment = require('moment');
const clientRestify = restify.createJsonClient({
  url: config.externals.CATALOG_URL
});
const FACTORY_OUTLET_WH = {
  id : 7,
  name : 'BRAINBEES SOLUTIONS PRIVATE LIMITED',
  state : 'KARNATAKA',
  gstNo : '29AAECB1042N1ZM',
  address : 'Survey no 80/6, Chokkahalli Village, Shiddlagata Main Road, Hoskote Taluk',
  pinCode : '562114'
};
const CLOTHESHSN = [61, 62, 63];
const CLOTHESHSNCAP = [6505];
const CLOTHESAMOUNTCAP = 1050;
const CLOTHESMINGST = 5;
const CLOTHESMAXGST = 12;
const FOOTWAREHSN = [64];
const FOOTWAREAMOUNTCAP = 1050;
const FOOTWAREMINGST = 5;
const FOOTWAREMAXGST = 18;
const MLLGSTNo = factoryOutletConfig.MLLGSTNo;
const EinvoiceCentralisedAPI = factoryOutletConfig.EinvoiceCentralisedAPI + 'addeinvoicedata';
const RivigoGSTNo = factoryOutletConfig.RivigoGSTNo;
const DelhiveryGSTNo = factoryOutletConfig.DelhiveryGSTNo;
const POSUpdateStatusApi = config.posAPIURL + 'api/factoryoutlet/status';
const POSConsignmentCreationApi = config.posAPIURL + 'api/factoryoutlet/consignment';
const POSAuthUrl = config.posAPIURL + 'api/auth/local/admin';
const WHSecondaryPOApi = factoryOutletConfig.whPOApiUrl + 'Services/FactoryOutletServices.svc/AddPrimaryPODetails';
const WHUpdateLoadApi = factoryOutletConfig.whLoadApiUrl + 'updateloadeinvioce';
const WHAuthToken = factoryOutletConfig.whLoadApiUrl + 'getToken';
const EInvoiceApi = factoryOutletConfig.EInvoiceAPIUrl;
const EWayBillApi = factoryOutletConfig.EWAYBillApiUrl;

const createOrderId = function(orderObj) {
  // Get the current user user Id and append to order ID
  const currentDate = new Date();
  // get the last two digit of current year and append to order Id
  let ordYear = currentDate.getFullYear();
  ordYear = ordYear.toString().substring(2);
  let orderId = orderObj.franchisee.id + ordYear;
  // Get the current hours , add to 65 and get the resultant charcater, append to orderId
  const ordHours = String.fromCharCode(65 + currentDate.getHours());
  orderId = orderId + ordHours;

  // generates random bytes based on length of current orderId
  // divide by 2 is used as hex doubles the generated chars
  // we are doing this because we cannot exceed orderId by 14 chars
  // as delhi govt waybill accepts orderId till 15 chars max.
  const maxBytes = Math.floor((14 - orderId.length) / 2);
  orderId = orderId + crypto.randomBytes(maxBytes).toString('hex').toUpperCase() + 'T';
  return orderId;
};

const sendMail = (mailObj) => {
  let mail = `<p></p><p></p> <p><b>${mailObj.info}</b></p>`;
  if (mailObj.description) {
    mail += `<p><b>Description - </b>${mailObj.description || ''} </p>`;
  }
  if (mailObj.error) {
    mail += `<p><b>Error - </b>${mailObj.error} </p>`;
  }
  if (mailObj.apiUrl) {
    mail += `<p><b>API Url - </b>${mailObj.apiUrl} </p>`;
  }
  if (mailObj.payload) {
    mail += `<p><b>Payload - </b>${mailObj.payload} </p>`;
  }
  if (mailObj.apiPayload) {
    mail += `<p><b>API Payload - </b>${mailObj.apiPayload} </p>`;
  }
  let mailToArray = [];
  if (mailObj.disablePayload) {
    mailToArray = [...bulkEmails.FactoryOutletOrder, ...bulkEmails.FactoryOutletEwayBill];
  } else {
    mailToArray = [...bulkEmails.FactoryOutletOrder];
  }
  const objMail = {
    to: mailToArray.join('|'),
    subject: 'Factory Outlet B2B Order',
    html: mail +
      'Regards,'
  };
  return mailer.sendBulkMail(objMail);
};

const getPOSToken = () => {
  return new Promise((resolve, reject) => {
    return request({
      uri: POSAuthUrl,
      method: 'POST',
      json: posCredential
    }, function(error, response, authBody) {
      if (response && response.statusCode === 200) {
        return resolve(authBody.token);
      } else {
        const err = response && response.body ? response.body : error;
        return reject(err);
      }
    });
  });
};

function getAge(product) {
  let ageTo;
  if (!Number.isInteger(product)) {
    product = Math.round(product * 100);
    ageTo = product.toString();
    product = product / 100;
    if (ageTo.charAt(ageTo.length - 1) === '0') {
      ageTo = product.toString() + '0';
    } else {
      ageTo = product.toString();
    }
  } else {
    ageTo = product.toString();
  }
  let arr;
  let totalAge;
  if (ageTo.indexOf('.') > -1) {
    arr = ageTo.split('.');
    if (arr[1] >= 12 && arr[0] === 0) {
      const remainder = arr[1] % 12;
      if (remainder > 0) {
        arr[1] = arr[1] - remainder;
        arr[0] = (arr[1] / 12) + Number(arr[0]);
        totalAge = (arr[0] * 365) + ((remainder) * 30);
      } else {
        arr[0] = (arr[1] / 12) + Number(arr[0]);
        totalAge = (arr[0] * 365);
      }
    } else if (Number(arr[0]) > 0) {
      const agetoM = product - Math.floor(product);
      totalAge = (Math.floor(product) * 365) + ((12 * agetoM) * 30);
    } else {
      totalAge = ageTo.indexOf('0') === 0 ? Number(arr[1]) * 30 : (arr[0] * 365 + Number(arr[1]) * 30);
    }
  } else {
    totalAge = ageTo === '0' ? product * 30 : product * 365;
  }
  return totalAge;
}

const buildOrderItemObject = function(factoryDetailsData, purchaseOrderMasterObj, productInfo) {
  try {
    const orderItemsArray = [];
    let counter = 1;
    factoryDetailsData.forEach((item) => {
      _.some(productInfo, (product) => {
        if (product.id == item.productID) {
          const itemObj = {};
          itemObj.POItemID = purchaseOrderMasterObj.POID + '' + counter++ ;
          itemObj.POID = purchaseOrderMasterObj.POID;
          itemObj.ProductID = item.productID;
          itemObj.ProductInfoID = product.infoId;
          itemObj.ManufactureBarcode = product.barcode;
          itemObj.ProductName = product.name;
          itemObj.ProductDesc = product.desc;
          itemObj.ProductType = product.productType && product.productType.name ? product.productType.name : '';
          itemObj.BrandID = product.brandId;
          itemObj.SubCatID = product.subcatId;
          itemObj.Size = product.size;
          itemObj.Unit = product.unit;
          itemObj.Color = product.color;
          itemObj.offer = product.offer;
          itemObj.OfferType = product.offerType;
          itemObj.Quantity = item.quantity;
          itemObj.OrderedQuantity = item.quantity;
          itemObj.GroupID = product.groupID;
          itemObj.UserID = purchaseOrderMasterObj.UserID;
          itemObj.StockType = product.stockType;
          itemObj.Lastmodifyby = factoryOutletAdmin;
          itemObj.LastModifyDate = purchaseOrderMasterObj.createdDate;
          itemObj.isReturnable = false;
          itemObj.ShippingReferenceNo = item.id;
          if (product.shippingtime && product.shippingtime.minimumShipHours) {
            itemObj.minimumShipHours = product.shippingtime.minimumShipHours;
          }
          itemObj.typeid = product.producttype && product.producttype.id ? product.producttype.id : null;
          itemObj.gender = product.gender;
          if (product.age && product.age.to >= 0) {
            itemObj.age = getAge(product.age.to);
          }
          itemObj.MRP = parseFloat(item.mrp);
          let ctc = 0;
          let baseCost = 0;
          let productBaseCost = 0;
          let netCost = 0;
          let vat = 0;
          let IGST = 0;
          let CGST = 0;
          let SGST = 0;
          if ((product.retailerMargin && parseFloat(product.retailerMargin) > 0) &&
            (product.gstratemaster && product.gstratemaster.HSNCode)) {
            IGST = (product.gstratemaster && product.gstratemaster.IGST) ? parseFloat(product.gstratemaster.IGST) : 0;
            CGST = (product.gstratemaster && product.gstratemaster.CGST) ? parseFloat(product.gstratemaster.CGST) : 0;
            SGST = (product.gstratemaster && product.gstratemaster.SGST) ? parseFloat(product.gstratemaster.SGST) : 0;
            if (FACTORY_OUTLET_WH.state.toLowerCase() !== purchaseOrderMasterObj.ShipState.toLowerCase()) {
              vat = product.gstratemaster.IGST;
              itemObj.GSTType = 'IGST';
            } else {
              vat = product.gstratemaster.CGST + product.gstratemaster.SGST;
              itemObj.GSTType = 'SGST-CGST';
            }
            ctc = (parseFloat(item.mrp) * ((1 - ((product.retailerMargin) / 100)))).toFixed(2);
            if (product.gstratemaster.HSNCode && ((CLOTHESHSN.indexOf(Number(product.gstratemaster.HSNCode.substr(0, 2))) !== -1) ||
             ((CLOTHESHSNCAP.indexOf(Number(product.gstratemaster.HSNCode.substr(0, 4))) !== -1) && (product.catId === 6)))) {
              if (parseFloat(ctc) <= CLOTHESAMOUNTCAP) {
                vat = CLOTHESMINGST;
                IGST = CLOTHESMINGST;
                CGST = CLOTHESMINGST / 2;
                SGST = CLOTHESMINGST / 2;
              } else {
                vat = CLOTHESMAXGST;
                IGST = CLOTHESMAXGST;
                CGST = CLOTHESMAXGST / 2;
                SGST = CLOTHESMAXGST / 2;
              }
            }
            if (product.gstratemaster.HSNCode && FOOTWAREHSN.indexOf(Number(product.gstratemaster.HSNCode.substr(0, 2))) !== -1) {
              if (parseFloat(ctc) <= FOOTWAREAMOUNTCAP) {
                vat = FOOTWAREMINGST;
                IGST = FOOTWAREMINGST;
                CGST = FOOTWAREMINGST / 2;
                SGST = FOOTWAREMINGST / 2;
              } else {
                vat = FOOTWAREMAXGST;
                IGST = FOOTWAREMAXGST;
                CGST = FOOTWAREMAXGST / 2;
                SGST = FOOTWAREMAXGST / 2;
              }
            }

            baseCost = Number((item.mrp * (1 - (product.retailerMargin / 100)) / (1 + (vat / 100))).toFixed(2));
            netCost = Number((baseCost + (baseCost * vat) / 100).toFixed(2));

            /**
             * Here we calculate productBaseCost on basis of ctc and creditnote
             * of product Info only to put in db for calculation of net cost
             * we use retailerMargin.
             */
            if (product.productinfo && product.productinfo.costtocompany && product.productinfo.creditnote) {
              productBaseCost = Number(product.productinfo.costtocompany * (1 - (product.productinfo.creditnote / 100)));
            }
          }
          itemObj.IGST = IGST;
          itemObj.CGST = CGST;
          itemObj.SGST = SGST;
          itemObj.VAT = vat;
          itemObj.HSNCode = (product.gstratemaster && product.gstratemaster.HSNCode) ? product.gstratemaster.HSNCode : '';
          itemObj.BaseCost = productBaseCost;
          itemObj.ActualPrice = netCost;
          itemObj.TotalPrice = Number((item.quantity * netCost).toFixed(2));
          itemObj.Discount = Number((item.mrp - netCost).toFixed(2));
          // update master payment Object
          purchaseOrderMasterObj.NetPayment = Number((purchaseOrderMasterObj.NetPayment + itemObj.TotalPrice).toFixed(2));
          purchaseOrderMasterObj.TotalPayment = purchaseOrderMasterObj.NetPayment;
          purchaseOrderMasterObj.CouponDiscount = Number((purchaseOrderMasterObj.CouponDiscount + itemObj.Discount).toFixed(2));
          orderItemsArray.push(itemObj);
        }
      });
    });
    return orderItemsArray;
  } catch (e) {
    logger.debug({
      tags: FactoryOutletOrder.tags,
      object_ids: [purchaseOrderMasterObj.POID],
      error: JSON.stringify(e)
    }, 'Error occured in building Factory Outlet order details for b2b_purchaseorderdetail');
  }
};

// build order Object for Purchase Order master
// factoryOutletDetails is array of array, each array consisting of factory outlet primary Orders wrt rank.
const buildOrderObject = function(factoryOutletDetails, factoryOutletmaster, productInfo) {
  try {
    logger.debug('building order object for: ', factoryOutletmaster.id);
    const masterOrderObj = {
      UserID: factoryOutletmaster.franchisee.id,
      WareHouseID: FACTORY_OUTLET_WH.id,
      BillFirstName: factoryOutletmaster.franchisee.firstname,
      BillEmailAddress: factoryOutletmaster.franchisee.email,
      BillMobileNo: factoryOutletmaster.franchisee.mobileNumber,
      BillAddressLine1: factoryOutletmaster.franchisee.address1,
      BillAddressLine2: factoryOutletmaster.franchisee.address2,
      BillPhoneNo: factoryOutletmaster.franchisee.phoneNumber,
      BillCity: factoryOutletmaster.franchisee.city,
      BillState: factoryOutletmaster.franchisee.state,
      BillPinCode: factoryOutletmaster.franchisee.pincode,
      ShipFirstName: factoryOutletmaster.franchisee.firstname,
      ShipLastName: factoryOutletmaster.franchisee.lastname,
      ShipMobileNo: factoryOutletmaster.franchisee.mobileNumber,
      ShipAddressLine1: factoryOutletmaster.franchisee.shippingAddress1,
      ShipAddressLine2: factoryOutletmaster.franchisee.shippingAddress2,
      ShipPhoneNo: factoryOutletmaster.franchisee.phoneNumber,
      ShipCity: factoryOutletmaster.franchisee.shippingCity,
      ShipState: factoryOutletmaster.franchisee.shippingState,
      ShipPinCode: factoryOutletmaster.franchisee.shippingPincode,
      CustomerNumber: factoryOutletmaster.franchisee.customerNumber ? factoryOutletmaster.franchisee.customerNumber : '',
      referralcode : factoryOutletmaster.referenceID,
      ReferedBy: factoryOutletmaster.franchisee.myReferral ? factoryOutletmaster.franchisee.myReferral : '',
      PaymentTypeID: 3,
      PaymentStatusID: 2,
      ConfirmationDate : new Date(),
      ConfirmedBy : factoryOutletAdmin,
      // provided by POS
      createdDate: factoryOutletmaster.salesCloseDate,
      modifydate: factoryOutletmaster.salesCloseDate,
      modifyby: factoryOutletAdmin,
      Status: 'Confirmed',
      createdBy : factoryOutletAdmin,
      POType : 'Factory',
      NetPayment : 0,
      TotalPayment : 0,
      CouponDiscount : 0,
      documenttype: 'TaxInvoice',
      servicetype: 'Cargo',
      PreferredCourier: 'All',
      weightcriteria: 'NA'
    };
    const secondaryOrder = [];
    // factoryDetail is array of arrays each containing object of item details based on rank
    _.forEach(factoryOutletDetails, (orderDetail) => {
      // orderdetail - array with objects with each line items of factoryoutletdetails
      masterOrderObj.POID =  createOrderId(factoryOutletmaster);
      masterOrderObj.TotalItems = orderDetail.length;
      masterOrderObj.TotalQuantity = _.sum(orderDetail, (o) => o.quantity);
      const masterOrderObjCopy = Object.assign({}, masterOrderObj);
      const orderDetailArray = buildOrderItemObject(orderDetail, masterOrderObjCopy, productInfo);
      // create a new object and assign it to masterOrderObj, to avoid same refernce
      const purchaseOrderData = {
        masterObj : masterOrderObjCopy,
        detailsArray : orderDetailArray
      };
      secondaryOrder.push(purchaseOrderData);
    });
    return secondaryOrder;
  } catch (e) {
    logger.debug({
      tags: FactoryOutletOrder.tags,
      error: JSON.stringify(e)
    }, 'Error occured in building Factory Outlet order for b2b_purchaseordermaster');
  }
};

const createSecondaryPO = (POCreationObj) => {
  return new Promise((resolve, reject) => {
    return request({
      uri : WHSecondaryPOApi,
      method :'POST',
      body : POCreationObj,
      headers : {
        'Content-Type' : 'application/json'
      },
      json : true
    }, function(error, POResponse, body) {
      if (POResponse && POResponse.statusCode === 200 && body && body.status) {
        return resolve();
      } else {
        const POErr = body && body.message ? body.message : error;
        return reject(POErr);
      }
    });
  });
};

// this function will set the status "inProcess" for primary order in POS db.
const updatePrimaryOrderStatus = (id) => {
  logger.debug('Updating Primary order status in POS for Factory Outlet request Id : ', id);
  const statusUpdationObj = {
    factoryOutletID : id
  };
  return new Promise((resolve, reject) => {
    return getPOSToken().then((token) => {
      return request({
        uri : POSUpdateStatusApi,
        headers : {
          authorization : token
        },
        method :'PUT',
        json : true,
        body :statusUpdationObj
      }, function(error, response) {
        if (response && response.statusCode === 200) {
          return resolve();
        } else {
          return reject(error);
        }
      });
    });
  });
};

const checkProductsAvaibility = (orderedProducts, catalogProducts) => {
  const notAvailableProducts = [];
  const catalogProductIds = _.map(catalogProducts, 'id');
  _.forEach(orderedProducts, (productid) => {
    if (catalogProductIds.indexOf(Number(productid)) === -1) {
      notAvailableProducts.push(Number(productid));
    }
  });
  return notAvailableProducts;
};

/**
 * This function is used to create Factory Outlet secondary order based on POS db primary order
 */
const createFactoryOutletOrderFunction = () => {
  const mailerObj = {
    info : 'Error while creating Factory Outlet Order.',
    description : ''
  };
  // fetch records with initiated status
  return posmain.factoryOutlet.findAll({
    where : {
      status : 'initiated'
    },
    include : [
      {
        model : posmain.factoryOutletDetails,
        required : true
      }
    ]
  }).then((response) => {
    if (response && response.length) {
      const orders = JSON.parse(JSON.stringify(response));
      // getting franchisee details
      const users = _.map(orders, 'destinationB2bid');
      logger.debug('Primary orders for processing: ', orders);
      return b2bdb.user.findAll({
        where : {
          id : users
        },
        raw : true,
      }).then((userRes) => {
        // add user data to the existing factory outlet franchisee object with respect to destination b2b id
        _.forEach(orders, (order) => {
          userRes.some((user) => {
            if (user.id == order.destinationB2bid) {
              order.franchisee = Object.assign({}, user);
            }
          });
        });
        /* process each line item from POS Factory outlet
         this line item belongs to single destination franchisee */
        return db.sequelize.Promise.mapSeries(orders, (order) => {
          return new Promise((resolve1, reject1) => {
            const productids = _.uniq(_.map(order.factoryOutletDetails, 'productID'));
            return clientRestify.post('/api/products/infoforfactoryoutlet', {
              products: productids,
              userState: order.franchisee.shippingState,
              fields: ['id', 'name', 'desc', 'groupID', 'stock', 'currentStock',
                'stockType', 'mrp', 'vat', 'retailerMargin', 'barcode', 'size', 'catId', 'b2bIsActive',
                'subcatId', 'brandId', 'discount', 'color', 'unit',
                'offer', 'infoId', 'gender', 'age'
              ]
            }, (err1, productInfoReq, resp, productsInfo) => {
              if (err1) {
                logger.error('Error while getting products Info from catalog.', err1);
                return reject1(err1);
              } else {
                // check if all the ordered products are available in the Catalog DB and having HSNCode
                // nonAvailableProducts is array of the product ids which are not available in catalog db
                const nonAvailableProducts = checkProductsAvaibility(productids, productsInfo);
                if (nonAvailableProducts.length === 0) {
                  /* grouping factoryOutletDetails data based on rank gives object with the rank-
                  { '0' : [data], '1' : [data] }
                   remove the rank and push the rank data in an array like [[data], [data]],
                  and split the secondary order on the basis of the index */
                  const groupPrimaryOrder = _.groupBy(order.factoryOutletDetails, 'rank');
                  const splitPrimaryOrder = [];
                  for (const rank in groupPrimaryOrder) {
                    splitPrimaryOrder.push(groupPrimaryOrder[rank]);
                  };
                  // format- splitPrimaryOrder = [ [{ details data rank 1}], [{details data rank 2}] ]
                  /* secondaryOrder is array of object consisting of further splited order's master and details objects
                  so that we can create entry in purchaseordermaster and details according to the respective poid.
                  format- secondaryOrder = [ { masterObj : {data}, detailsObj : [data, data]}, {}...] */
                  const secondaryOrder = buildOrderObject(splitPrimaryOrder, order, productsInfo);
                  // this combined data of splited poids will be required for inserting in the b2b factoryoutlet table
                  let totalItems = 0;
                  let totalQuantity = 0;
                  let totalAmount = 0;
                  // POCreationData & POCreationObjectdata will be required for the POCreation Wh service
                  const POCreationData = [];
                  const POCreationObject = {
                    vendorcode : order.vendorCode,
                    warehouseid : FACTORY_OUTLET_WH.id,
                    cpoid : order.referenceID,
                    createdby : factoryOutletAdmin
                  };
                  _.forEach(secondaryOrder, (obj) => {
                    // data for factoryoutlet table
                    totalItems += obj.masterObj['TotalItems'];
                    totalAmount += obj.masterObj['TotalPayment'];
                    totalQuantity += _.sum(obj.detailsArray, (o) => o.Quantity);
                    // data for POCreation
                    POCreationData.push(Object.assign({ b2bpoid : obj.masterObj['POID'] }, POCreationObject));
                  });
                  return db.sequelize.transaction().then((t) => {
                    const factoryOutletObj = {
                      factoryoutletId : order.id,
                      primaryUserId : order.sourceB2bid,
                      secondaryUserId : order.destinationB2bid,
                      referenceNo : order.referenceID,
                      status : 'ordercreated',
                      poid : _.map(secondaryOrder, 'masterObj.POID'),
                      items : totalItems,
                      quantity : totalQuantity,
                      totalAmount : Number(totalAmount.toFixed(2)),
                      createdBy : factoryOutletAdmin,
                      salesCloseDate : order.salesCloseDate,
                      awbNo : order.AWB,
                      primarysaletotalamount : order.grandtotal,
                      amount : order.grandtotal,
                      ledgeraccount : 1,
                      warehouse : FACTORY_OUTLET_WH.id,
                      accounttype : 'CN'
                    };
                    return db.factoryoutlet.create(factoryOutletObj, {
                      transaction : t
                    }).then(() => {
                      return db.sequelize.Promise.mapSeries(secondaryOrder, (data) => {
                        return new Promise((resolve2, reject2) => {
                          return db.b2b_purchaseordermaster.create(data.masterObj, {
                            transaction: t
                          }).then(() => {
                            return db.b2b_purchaseorderdetail.bulkCreate(data.detailsArray, {
                              transaction: t,
                              hooks: false
                            }).then(() => {
                              return resolve2();
                            });
                          })
                            .catch((B2BOrderErr) => {
                              t.rollback();
                              const errMsg = 'Error while creating Order in B2b purchaseordermaster' +
                              'and purchaseorderdetails for the Factory Outlet request Id : ' +
                              order.id + ', for the franchisee : ' + order.franchisee.id;
                              logger.error('createFactoryOutletOrder : B2BOrderErr- ' + errMsg, B2BOrderErr);
                              if (mailerObj.description === '') {
                                mailerObj.description = errMsg;
                                mailerObj.error = JSON.stringify(B2BOrderErr);
                                mailerObj.payload = JSON.stringify(order);
                                sendMail(mailerObj);
                              }
                              return reject2(B2BOrderErr);
                            });
                        });
                      }).then(() => {
                        /* this function will set the status "inProcess" for primary order in POS db.
                        so that the current scheduler wont pickup the same primary order beacause
                         its secondary order and primary order is already created
                         parameter passed :- primary order unique factory outlet request id
                         */
                        return updatePrimaryOrderStatus(order.id).then(() => {
                          const logMsg = 'Factory Outlet Secondary Order created successfully having POID(s): ' + _.map(POCreationData, 'b2bpoid') +
                          ' of total amount Rs. ' + factoryOutletObj.totalAmount + ' for the factory outlet request Id : ' + order.id +
                          ' for the franchisee :  ' + order.franchisee.id;
                          logger.debug(logMsg);
                          const mailerObject = {
                            info : 'Factory Outlet Secondary order created successfully',
                            description : logMsg,
                            payload : JSON.stringify(factoryOutletObj)
                          };
                          sendMail(mailerObject);
                          t.commit();
                          const POParams = {
                            objFactoryOutletPrimaryPO : POCreationData
                          };
                          return createSecondaryPO(POParams).then(() => {
                            logger.debug('Factory Outlet Secondary PO created successfully for the Fatcory Outlet request ID- ' + order.id +
                          ' for the franchisee:  ' + order.franchisee.id + ', with the POID(s):  ' + _.map(POCreationData, 'b2bpoid').join(', '));
                            return resolve1();
                          })
                            .catch((POCreationErr) => {
                              const errMsg = 'Error while creating PO for the POID(s) : ' +
                              _.map(POCreationData, 'b2bpoid').join(', ') +
                              ', having Factory Outlet request Id : ' + order.id + ' for the franchisee : ' + order.franchisee.id;
                              logger.error('createFactoryOutletOrder : POCreationErr- ' + errMsg, POCreationErr);
                              if (mailerObj.description === '') {
                                mailerObj.info = `Error while Secondary PO creation after
                                successfull creation of Factory Outlet secondary orders`;
                                mailerObj.description = errMsg;
                                mailerObj.error = JSON.stringify(POCreationErr);
                                mailerObj.apiUrl = WHSecondaryPOApi;
                                mailerObj.payload = JSON.stringify(POParams);
                                sendMail(mailerObj);
                              }
                              return reject1();
                            });
                        })
                          .catch((primaryOrderUpdateErr) => {
                            const errMsg = 'Error while updating Primary order status to inprocess in POS DB for the Factory Outlet request Id : ' + order.id +
                            +  ', for the franchisee : ' + order.franchisee.id + '. Please, re-run the scheduler';
                            logger.error('createFactoryOutletOrder : primaryOrderUpdateErr- ' + errMsg, primaryOrderUpdateErr);
                            if (mailerObj.description === '') {
                              mailerObj.description = errMsg;
                              mailerObj.error = JSON.stringify(primaryOrderUpdateErr);
                              mailerObj.apiUrl = POSUpdateStatusApi;
                              mailerObj.payload = JSON.stringify(order);
                              sendMail(mailerObj);
                            }
                            t.rollback();
                            return reject1();
                          });
                      })
                        .catch((innerMapSeriesErr) => {
                          const errMsg = 'Error in innerMapSeries while creating Secondary Order for the Factory Outlet request Id : ' + order.id;
                          logger.error('createFactoryOutletOrder : primaryOrderUpdateErr- ' + errMsg, innerMapSeriesErr);
                          if (mailerObj.description === '') {
                            mailerObj.description = errMsg;
                            mailerObj.error = JSON.stringify(innerMapSeriesErr);
                            mailerObj.payload = JSON.stringify(order);
                            sendMail(mailerObj);
                          }
                          return reject1(innerMapSeriesErr);
                        });
                    })
                      .catch((FODbErr) => {
                        t.rollback();
                        const errMsg = 'Error while creating Factory Outlet order entry in ' +
                        'factoryoutlet table for the factoryOutlet ID' +
                        order.id + ' for the franchisee id : ' + order.franchisee.id;
                        logger.error('createFactoryOutletOrder : FODbErr - ' + errMsg, FODbErr);
                        if (mailerObj.description === '') {
                          mailerObj.description = errMsg;
                          mailerObj.error = JSON.stringify(FODbErr);
                          mailerObj.payload = JSON.stringify(order);
                          sendMail(mailerObj);
                        }
                        return reject1(FODbErr);
                      });
                  });
                } else {
                  const errMsg = 'Following products ' +
                  'are not available in the Catalog table or does not have valid HSN Code, for the Factory Outlet request Id : ' +
                  order.id + ' for the franchisee id : ' + order.franchisee.id + ', please re-run the scheduler. ' +
                  'Not available product Ids : ' + nonAvailableProducts.join(', ');
                  logger.error('createFactoryOutletOrder : FODbErr - ' + errMsg);
                  mailerObj.description = errMsg;
                  mailerObj.error = 'Products not available in Catalog table or does not have valid HSN code.';
                  mailerObj.payload = JSON.stringify(order);
                  sendMail(mailerObj);
                  return reject1(errMsg);
                }
              }
            });
          });
        })
          .then(() => {
            return Promise.resolve();
          })
          .catch((mapSeriesErr) => {
            const errMsg = 'Error while processing each Factory Outlet order';
            logger.error('createFactoryOutletOrder : mapSeriesErr- ' + errMsg, mapSeriesErr);
            if (mailerObj.descrption === '') {
              mailerObj.description = errMsg;
              mailerObj.error = JSON.stringify(mapSeriesErr);
              sendMail(mailerObj);
            }
            return Promise.reject(mapSeriesErr);
          });
      })
        .catch((getFranchiseeErr) => {
          const errMsg = 'Error while fetching the Factory Outlet store info for the user Ids : '  + users.join(', ');
          logger.error('createFactoryOutletOrder : getFranchiseeErr- ' + errMsg, getFranchiseeErr);
          if (mailerObj.description === '') {
            mailerObj.description = errMsg;
            mailerObj.error = JSON.stringify(getFranchiseeErr);
            sendMail(mailerObj);
          }
          return Promise.reject(getFranchiseeErr);
        });
    } else {
      const errMsg = 'No Factory Outlet orders found for processing for the date-  ' + moment(new Date()).format('YYYY-MM-DD');
      logger.debug('createFactoryOutletOrder- ' + errMsg);
      mailerObj.info = errMsg;
      sendMail(mailerObj);
      return Promise.resolve(errMsg);
    }
  })
    .catch((fetchPrimaryOrdersErr) => {
      const errMsg = 'Error while fetching Primary Factory Outlet Data from POS DB, for the date-  ' +  moment(new Date()).format('YYYY-MM-DD');
      logger.error('createFactoryOutletOrder : fetchPrimaryOrdersErr- ' + errMsg, fetchPrimaryOrdersErr);
      if (mailerObj.description === '') {
        mailerObj.description = errMsg;
        mailerObj.error = JSON.stringify(fetchPrimaryOrdersErr);
        sendMail(mailerObj);
      }
      return Promise.reject(fetchPrimaryOrdersErr);
    });
};

exports.createFactoryOutletOrder = function(req, res, next) {
  // we have created this function so that we can run this schedulrer manually
  return createFactoryOutletOrderFunction().then(() => {
    return res.send('Factory Outlet order Scheduler completed');
  })
    .catch((error) => {
      logger.error('Error while running Factory Outlet Scheduler manually.', error);
      return next(new restify.InternalError(error));
    });
};

exports.createFactoryOutletOrderFunction = createFactoryOutletOrderFunction;

const getFranchiseeDetails = (userid) => {
  return new Promise((resolve, reject) => {
    return b2bdb.user.findOne({
      where : {
        id : userid
      },
      raw : true,
      attributes : [['companyname', 'name'], ['gstnumber', 'gstNumber'],
        [b2bdb.Sequelize.fn('concat', b2bdb.Sequelize.col('shippingaddress1'), ', ',
          b2bdb.Sequelize.col('shippingaddress2')), 'address'],
        ['shippingpincode', 'pinCode'], ['shippingstate', 'state']]
    }).then((userResp) => {
      return resolve(userResp);
    })
      .catch((userErr) => {
        return reject(userErr);
      });
  });
};
const getPurchaseDetailsLineItems = (poids) => {
  return new Promise((resolve, reject) => {
    return db.b2b_purchaseorderdetail.findAll({
      where : {
        poid : {
          $in : poids
        }
      },
      raw : true,
      attributes : [
        ['hsncode', 'hsnCode'],
        ['totalprice', 'net'], 'actualprice',
        ['quantity', 'qty'],
        ['cgst', 'cgstRate'], ['sgst', 'sgstRate'], ['igst', 'igstRate'], 'gsttype']
    }).then((purchaseResp) => {
      _.forEach(purchaseResp, (item) => {
        // we require gross amount, cgst,sgst and net amount for the shipped quantity not for a single
        item.commName = 'Baby Products';
        item.cessRate = 0.0;
        item.cessAmt = 0.0;
        item.hsnCode = item.hsnCode.substr(0, 4);
        if (item.gsttype === 'IGST') {
          item.cgstRate = 0.0;
          item.cgstAmt = 0.0;
          item.sgstRate = 0.0;
          item.sgstAmt = 0.0;
          let grossOfSingleQuantity = 0;
          let igstAmtOfSingleQuantity = 0;
          grossOfSingleQuantity = Number(((100 / (100 + Number(item.igstRate))) * Number(item.actualprice)).toFixed(2));
          igstAmtOfSingleQuantity = Number((grossOfSingleQuantity * Number(item.igstRate) / 100).toFixed(2));
          item.gross = Number((grossOfSingleQuantity * Number(item.qty)).toFixed(2));
          item.igstAmt = Number((igstAmtOfSingleQuantity * item.qty).toFixed(2));
        } else {
          item.igstRate = 0.0;
          item.igstAmt = 0.0;
          let grossOfSingleQuantity = 0;
          let cgstAmtOfSingleQuantity = 0;
          let sgstAmtOfSingleQuantity = 0;
          grossOfSingleQuantity = Number(((100 / (100 + Number(item.cgstRate) + Number(item.sgstRate))) * Number(item.actualprice)).toFixed(2));
          cgstAmtOfSingleQuantity = Number((grossOfSingleQuantity * Number(item.cgstRate) / 100).toFixed(2));
          sgstAmtOfSingleQuantity = Number((grossOfSingleQuantity * Number(item.sgstRate) / 100).toFixed(2));
          item.gross = Number((grossOfSingleQuantity * Number(item.qty)).toFixed(2));
          item.cgstAmt = Number((cgstAmtOfSingleQuantity * Number(item.qty)).toFixed(2));
          item.sgstAmt = Number((sgstAmtOfSingleQuantity * Number(item.qty)).toFixed(2));
        }
      });
      const products = Object.assign([], purchaseResp);
      const groupByHSNProducts = [];
      _.forEach(products, (p) => {
        if (!groupByHSNProducts.length) {
          groupByHSNProducts.push(p);
        } else {
          let isHSNAvailable;
          if (p.gsttype === 'IGST') {
            isHSNAvailable = _.findIndex(groupByHSNProducts, (h) => h.hsnCode === p.hsnCode && h.igstRate === p.igstRate);
          } else {
            isHSNAvailable = _.findIndex(groupByHSNProducts, (h) => h.hsnCode === p.hsnCode && h.cgstRate === p.cgstRate);
          }
          if (isHSNAvailable !== -1) {
            groupByHSNProducts[isHSNAvailable].net = Number((Number(groupByHSNProducts[isHSNAvailable].net) + Number(p.net)).toFixed(2));
            groupByHSNProducts[isHSNAvailable].qty = Number(groupByHSNProducts[isHSNAvailable].qty) + Number(p.qty);
            groupByHSNProducts[isHSNAvailable].gross = Number((Number(groupByHSNProducts[isHSNAvailable].gross) + Number(p.gross)).toFixed(2));
            if (p.gsttype === 'IGST') {
              groupByHSNProducts[isHSNAvailable].igstAmt = Number((Number(groupByHSNProducts[isHSNAvailable].igstAmt) + Number(p.igstAmt)).toFixed(2));
            } else {
              groupByHSNProducts[isHSNAvailable].cgstAmt = Number((Number(groupByHSNProducts[isHSNAvailable].cgstAmt) + Number(p.cgstAmt)).toFixed(2));
              groupByHSNProducts[isHSNAvailable].sgstAmt = Number((Number(groupByHSNProducts[isHSNAvailable].sgstAmt) + Number(p.sgstAmt)).toFixed(2));
            }
          } else {
            groupByHSNProducts.push(p);
          }
        }
      });
      return resolve(groupByHSNProducts);
    }).catch((purchaseDetailsErr) => {
      return reject(purchaseDetailsErr);
    });
  });
};

const updateFactoryOutletOrder = (params, factoryOutletId) => {
  logger.debug('Updating factoryOutlet order with : ' + JSON.stringify(params) + 'for the Factory Outlet request Id : ' + factoryOutletId);
  return new Promise((resolve, reject) => {
    return db.factoryoutlet.update(params,
      {
        where : {
          id : factoryOutletId
        }
      })
      .then(() => {
        return resolve();
      })
      .catch((factoryOutletUpdateErr) => {
        const errMSg = 'Error while updating Factory Outlet order data : ' + JSON.stringify(params) +
        ', for the Factory Outlet request Id : ' + factoryOutletId;
        logger.error('updateFactoryOutletOrder : factoryOutletUpdateErr  ' +  errMSg, factoryOutletUpdateErr);
        const mailerObj = {
          info : 'Error while processing Eway Bill.',
          description : errMSg,
          error : JSON.stringify(factoryOutletUpdateErr),
          payload : JSON.stringify(params)
        };
        sendMail(mailerObj);
        return reject(factoryOutletUpdateErr);
      });
  });
};

const getWhToken = () => {
  return new Promise((resolve, reject) => {
    return request({
      uri : WHAuthToken,
      method :'POST',
      json : true,
      body : factoryOutletConfig.whAuthCredentials
    }, function(whAuthError, whAuthResponse, body) {
      if (whAuthResponse && body && body.data) {
        return resolve(body.data);
      } else {
        const authErr = body && body.data ? body.data : whAuthError;
        return reject(authErr);
      }
    });
  });
};

const updateLoad = function(loadObject) {
  return new Promise((resolve, reject) => {
    return getWhToken().then((token) => {
      const reqHeaders = Object.assign({ Authorization : token }, factoryOutletConfig.whAuthCredentials);
      return request({
        uri : WHUpdateLoadApi,
        method :'POST',
        json : true,
        body :loadObject,
        headers : reqHeaders
      }, function(loadUpdationError, loadUpdateResponse, body) {
        if (loadUpdateResponse && body) {
          return resolve();
        } else {
          const loadErr = body && body.message ? body.message : loadUpdationError;
          const errMSg = 'Error while updating Load data with Load Id : ' + loadObject.loadid + ', after successfull creation of Eway Bill.';
          logger.error('updateLoad : ' + errMSg, loadUpdateResponse.body);
          const mailerObj = {
            info : 'Error while updating Load API',
            description : errMSg,
            error : loadErr,
            apiUrl : WHUpdateLoadApi,
            payload : JSON.stringify(loadObject)
          };
          sendMail(mailerObj);
          return reject(loadErr);
        }
      });
    });
  });
};

const updatedEwayBillToPOS = function(ewaybillObj) {
  console.log('in function here', ewaybillObj);
  return db.factoryoutlet.findOne({
    attributes: ['referenceno'],
    where : {
      id: ewaybillObj.referenceID
    },
    raw : true
  }).then((factoryOutletResp) => {
    console.log('checking factoryOutletResp here', factoryOutletResp);
    console.log('1111111', factoryOutletResp['referenceno']);
    ewaybillObj.referenceID = factoryOutletResp && factoryOutletResp['referenceno'] ? factoryOutletResp['referenceno'] : '';
  return new Promise((resolve, reject) => {
    return getPOSToken().then((token) => {
      return request({
        uri : 'https://stage.fcstore.in/api/admin/factoryoutlet/update/ewaybillinfo',
        method :'POST',
        headers : {
          authorization : token
        },
        json : true,
        body : ewaybillObj
      }, function(err, data) {
        // console.log('err====', err);
        console.log('err====', data);
        if (data.statusCode === 200) {
          return resolve(data.body);
        } else {
          const err = data && data.body ? data.body : err;
          return reject(err);
        }
      });
    });
  });
}).catch((error) => {
  console.log('error here', error);
})
}

const createEwayBillPayload = (factoryOutletData, loadData) => {
  return new Promise((resolve, reject) => {
    const EwayBillPayload = {
      requestId : loadData.loadId,
      credentials : factoryOutletConfig.EInvoiceLoginCredentials,
      ewaybills : []
    };
    const promiseArray = [];
    // get source franchisee
    promiseArray.push(getFranchiseeDetails(factoryOutletData.primaryUserId));
    // get destination franchisee
    promiseArray.push(getFranchiseeDetails(factoryOutletData.secondaryUserId));
    promiseArray.push(getPurchaseDetailsLineItems(factoryOutletData.poid));
    return Promise.all(promiseArray).then((promiseData) => {
      const shipFrom = promiseData[0];
      const shipTo = promiseData[1];
      const EwayBillObj = {
        formId : loadData.loadId,
        billFrom : {
          name : FACTORY_OUTLET_WH.name,
          gstNumber : FACTORY_OUTLET_WH.gstNo,
          address : FACTORY_OUTLET_WH.address,
          pinCode : FACTORY_OUTLET_WH.pinCode,
          state : FACTORY_OUTLET_WH.state
        },
        billTo : shipTo,
        consignor : shipFrom,
        consignee : shipTo,
        transporter: {
          id : loadData.transporterGSTNo,
          name :loadData.shippingCompany,
          transportMode : 'ROAD',
          vehicleNo : '',
          distance : 0,
          docNo : '',
          docDt : ''
        },
        invoice: {
          invoiceNo : loadData.loadId,
          invoiceDt : moment(loadData.loadCreationDate).format('YYYY-MM-DD'),
          invoiceVal : Number((_.sum(promiseData[2], (o) => o.net)).toFixed(2)),
          otherValue : 0.0,
          docType : 'INV',
          goodsDirection : 'OUT',
          purpose : 'SUPPLY'
        },
        lineItems : promiseData[2]
      };
      EwayBillPayload.ewaybills.push(EwayBillObj);
      const successMsg = '<br> Load Id : ' + loadData.loadId +
      ', <br> Reference Id : ' + factoryOutletData.id +
      ', <br> POID(s) : ' + factoryOutletData.poid.join(', ') +
      ', <br> Total Amount : Rs. ' + factoryOutletData.totalAmount +
      ', <br> Source Franchisee Id : ' + factoryOutletData.primaryUserId +
      ', <br> Destination Franchisee Id : ' + factoryOutletData.secondaryUserId;
      const mailerObj = {
        info : 'E-invoice payload generated successfully.',
        description : successMsg,
        payload : JSON.stringify(EwayBillPayload)
      };
      sendMail(mailerObj);
      return resolve(EwayBillPayload);
    })
      .catch((err) => {
        const errMsg = 'Error while creating payload for Eway Bill for the Load Id : '
        + loadData.loadId + ' and Factory Outlet request Id : ' + factoryOutletData.factoryoutletId;
        logger.error('createEwayBillPayload : ' + errMsg, err);
        const mailerObj = {
          info : 'Error while creating Eway Bill payload.',
          description : errMsg,
          error : JSON.stringify(err),
          apiUrl : EInvoiceApi,
          payload : JSON.stringify(EwayBillPayload)
        };
        sendMail(mailerObj);
        return reject(err);
      });
  });
};

/**
 * This api used for centralized finance system to push data in account team
 * we are using this api after generation of einvoice and load updation data.
 * @param {Object} [invoice]
 */

const dumpEinvoiceDate = (einvoiceObj, factoryOutletData, loadData) => {
  const poid = factoryOutletData.poid;
  return new Promise((resolve, reject) => {
    return createEwayBillPayload(factoryOutletData, loadData).then((EwayBillPayload) => {
      return db.b2b_purchaseordermaster.findAll({
        where : {
          poid : {
            $in : poid
          }
        },
        raw : true,
        attributes : [
          ['poid', 'poid'],
          ['netpayment', 'ordernetpayment'],
          ['totalitems', 'ordertotaliteemcount'],
          ['totalquantity', 'totalquantity'],
        ]
      }).then((orderinfoObj) => {
        _.forEach(orderinfoObj, (item) => {
          item.ordernetpayment = Number(item.ordernetpayment);
        });
        const orderInfo = Object.assign([], orderinfoObj);
        const totalQuantity = _.sum(orderinfoObj, 'totalquantity');
        const ordertotaliteemcount = _.sum(orderinfoObj, 'ordertotaliteemcount');
        const ordernetpayment = _.sum(orderinfoObj, 'ordernetpayment');
        const EinvoiceObj = {
          invoice : {
            invoiceno: EwayBillPayload.requestId,
            invoicedate: moment.tz(EwayBillPayload.ewaybills[0].invoice.invoiceDt, 'YYYY-MM-DD HH:mm:ss', 'UTC').format(),
            invoicevalue: ordernetpayment,
            invoicetotalitem: ordertotaliteemcount,
            invoicetotalquantity: totalQuantity,
            doctypeid: 1,
            transactiontypeid: 1,
            companycodeid: 1,
            purchasevendorcodeid: 1,
            billfromname: EwayBillPayload.ewaybills[0].billFrom.name,
            billfromgstnumber: EwayBillPayload.ewaybills[0].billFrom.gstNumber,
            billfromaddress: EwayBillPayload.ewaybills[0].billFrom.address,
            billfrompincode: EwayBillPayload.ewaybills[0].billFrom.pinCode,
            billfromstate: EwayBillPayload.ewaybills[0].billFrom.state,
            consignorname: EwayBillPayload.ewaybills[0].consignor.name,
            consignorgstnumber: EwayBillPayload.ewaybills[0].consignor.gstNumber,
            consignoraddress: EwayBillPayload.ewaybills[0].consignor.address,
            consignorpincode: EwayBillPayload.ewaybills[0].consignor.pinCode,
            consignorstate: EwayBillPayload.ewaybills[0].consignor.state,
            billtoname: EwayBillPayload.ewaybills[0].billTo.name,
            billtogstnumber: EwayBillPayload.ewaybills[0].billTo.gstNumber,
            billtoaddress: EwayBillPayload.ewaybills[0].billTo.address,
            billtopincode: EwayBillPayload.ewaybills[0].billTo.pinCode,
            billtostate: EwayBillPayload.ewaybills[0].billTo.state,
            consigneename: EwayBillPayload.ewaybills[0].consignee.name,
            consigneegstnumber: EwayBillPayload.ewaybills[0].consignee.gstNumber,
            consigneeaddress: EwayBillPayload.ewaybills[0].consignee.address,
            consigneepincode: EwayBillPayload.ewaybills[0].consignee.pinCode,
            consigneestate: EwayBillPayload.ewaybills[0].consignee.state,
            orderinfo: orderInfo,
            datasourceid: factoryOutletConfig.EinvoiceCentralizedCredentials.datasourceid,
            username: factoryOutletConfig.EinvoiceCentralizedCredentials.username,
            password: factoryOutletConfig.EinvoiceCentralizedCredentials.password,
          }
        };
        return request({
          uri :  EinvoiceCentralisedAPI,
          method :'POST',
          json : true,
          body : EinvoiceObj
        }, function(einvoiceError, einvoiceResponse, body) {
          if (einvoiceResponse && body) {
            return resolve();
          } else {
            const einvoiceCentralisedAPIErr = body && body.message ? body.message : einvoiceError;
            const errMsg = 'Error while inserting data to centralized api of account : '
            + EwayBillPayload.requestId + ' and Factory Outlet request Id : ' + factoryOutletData.factoryoutletId;
            logger.error('EinvoiceCentralisedAPI error : ' + errMsg);
            const mailerObj = {
              info : 'Error while inserting data to centralized finance account team.',
              description : errMsg,
              error : einvoiceCentralisedAPIErr,
              apiUrl : EinvoiceCentralisedAPI,
              payload : JSON.stringify(EinvoiceObj)
            };
            sendMail(mailerObj);
            return reject(einvoiceCentralisedAPIErr);
          }
        });
      })
      .catch((error) => {
        return reject(error);
      });
    })
    .catch((err) => {
      return reject(err);
    });
  });
};

const createEInvoice = (EwayBillPayload, factoryOutletData, loadData) => {
  const mailerObj = {
    info : 'Error while creating E-Invoice.'
  };
  const EInvoicePayload = {
    requestId : EwayBillPayload.requestId,
    credentials : factoryOutletConfig.EInvoiceLoginCredentials ? factoryOutletConfig.EInvoiceLoginCredentials : factoryOutletConfig.EwayBillLoginCredentials,
    eInvoices : EwayBillPayload.ewaybills
  };
  return new Promise((resolve, reject) => {
    return request.post({
      uri : EInvoiceApi,
      method :'POST',
      json : true,
      body : EInvoicePayload
    }, function(error, eInvoiceRes, body) {
      if (eInvoiceRes && eInvoiceRes.statusCode === 200 && body) {
        // resolve the response in following format
        // einvoice : {
        //   requestId : STRING,
        //   invoiceNo : STRING,
        //   ackNo : STRING,
        //   ackDt : STRING,
        //   irn : STRING,
        //   qrCode : STRING,
        //   qrCodeUrl : STRING
        // }
        return resolve(body);
      } else {
        const EwayBillErr = body && body.errors ? body.errors : body;
        const errMsg = 'Error while creating E-Invoice for the Load Id : ' + loadData.loadId +
        ' and Factory Outlet request Id : ' + factoryOutletData.factoryoutletId;
        logger.error('EwayBillGeneration : ' + errMsg, EwayBillErr);
        mailerObj.description = errMsg;
        mailerObj.error = JSON.stringify(EwayBillErr);;
        mailerObj.apiUrl = EInvoiceApi;
        mailerObj.payload = JSON.stringify(EInvoicePayload);
        mailerObj.apiPayload = JSON.stringify({
          factoryOutletData : factoryOutletData,
          loadData : loadData
        });
        sendMail(mailerObj);
        return reject(EwayBillErr);
      }
    });
  });
};
const createEWayBillFunction = (EwayBillPayload, factoryOutletData, loadData) => {
  const mailerObj = {
    info : 'Error while creating Eway Bill.'
  };
  const EwaybillPayloadData = {
    requestId : EwayBillPayload.requestId,
    credentials : factoryOutletConfig.EwayBillLoginCredentials,
    eInvoices : EwayBillPayload.ewaybills
  };
  return new Promise((resolve, reject) => {
    return request.post({
      uri : EWayBillApi,
      method :'POST',
      json : true,
      body : EwaybillPayloadData
    }, function(error, ewayBillRes, body) {
      if (ewayBillRes && body && body.successCount) {
        console.log('checking body here', body);
        // console.log('checking body here', body.generatedEWaybills);
        // console.log('checking body here', body.validity);
        const ewayBillNo = body.generatedEWaybills && body.generatedEWaybills[loadData.loadId] ? body.generatedEWaybills[loadData.loadId] : '';
        // const validity = null;
        // const validity1 = body.validity && ewayBillNo ? body.validity[ewayBillNo] : '';
        // console.log('checking validity here', validity);
        // console.log('checking validity here', validity1);
        // console.log('111111111', ewayBillNo);
        // console.log('111111111', loadData.loadId);
        // console.log('111111111', body.generatedEWaybills[loadData.loadId]);
        const successMsg =
        '<br> Eway Bill No. : ' + ewayBillNo;
        logger.debug('EwayBillGeneration : success, ' + successMsg);
        const suceessObj = {
          info : 'Ewaybill generated successfully.',
          description : successMsg,
          disablePayload : true
        };
        sendMail(suceessObj);
        return resolve({
          ewaybillno : ewayBillNo
        });
      } else {
        const EwayBillErr = body && body.errors ? body.errors : body;
        const errMsg = 'Error while creating Eway Bill for the Load Id : ' + loadData.loadId +
        ' and Factory Outlet request Id : ' + factoryOutletData.factoryoutletId;
        logger.error('EwayBillGeneration : ' + errMsg, EwayBillErr);
        mailerObj.description = errMsg;
        mailerObj.error = JSON.stringify(EwayBillErr);;
        mailerObj.apiUrl = EWayBillApi;
        mailerObj.payload = JSON.stringify(EwaybillPayloadData);
        mailerObj.apiPayload = JSON.stringify({
          factoryOutletData : factoryOutletData,
          loadData : loadData
        });
        sendMail(mailerObj);
        return reject(EwayBillErr);
      }
    });
  });
};
// in this function we generate EWay Bill based on the load data,consignment creation and update Load data
// this function is called through scheduler after order creation and load Creation
// if the order and load creation is successfull but the Ewaybill genearation api got error or api failed
// to generate Eway Bill then expilicitely call the generateEWayBill Api handler function
// in this function we generate EWay Bill based on the load data,consignment creation and update Load data
// this function is called through scheduler after order creation and load Creation
// if the order and load creation is successfull but the Ewaybill genearation api got error or api failed
// to generate Eway Bill then expilicitely call the generateEWayBill Api handler function
const EwayBillGeneration = function(factoryOutletData, loadData) {
  const loadUpdationObj = {
    loadid : loadData.loadId,
    einvoiceno: loadData.loadId,
    awbno : loadData.awbNo,
    shippingcompany : loadData.shippingCompany,
    lastmodifiedby : factoryOutletAdmin
  };
  return new Promise((resolve, reject) => {
    return createEwayBillPayload(factoryOutletData, loadData).then((EwayBillPayload) => {
      const Promises = [];
      Promises.push(createEInvoice(EwayBillPayload, factoryOutletData, loadData));
        // we have commented EWay Bill creation Function because it is not required as we are creating E-INVOICE
        // if both are required just uncomment following promise code
      Promises.push(createEWayBillFunction(EwayBillPayload, factoryOutletData, loadData));
      return Promise.all(Promises).then((promiseResp) => {
        // console.log('checking promises here', promiseResp[1]);
        loadUpdationObj.einvoicejson = promiseResp && promiseResp[0];
        loadUpdationObj.ewaybillno = promiseResp && promiseResp[1] && promiseResp[1].ewaybillno ? promiseResp[1].ewaybillno : '';
        // const data = promiseResp && promiseResp[1] && promiseResp[1].validity ? promiseResp[1].validity : '';
        let ewaybillObj = {
          referenceID: factoryOutletData.id,
          EWayBillNo: promiseResp[1].ewaybillno,
          EWayBillNoExpiry: null,
        }
        console.log('checking ewaybillObj here', ewaybillObj);
        console.log('checking expiry date here', data);
        const successMsg =
        '<br> Eway Bill No. : ' + loadUpdationObj.ewaybillno +
        '<br> Load Id : ' + loadData.loadId +
        ', <br> E-Invoice Url : ' + loadUpdationObj.einvoicejson &&
        loadUpdationObj.einvoicejson['qrCodeUrl'] ? loadUpdationObj.einvoicejson['qrCodeUrl'] : '' +
        ', <br> Reference Id : ' + factoryOutletData.id +
        ', <br> POID(s) : ' + factoryOutletData.poid.join(', ') +
        ', <br> Total Amount : Rs. ' + factoryOutletData.totalAmount +
        ', <br> Source Franchisee Id : ' + factoryOutletData.primaryUserId +
        ', <br> Destination Franchisee Id : ' + factoryOutletData.secondaryUserId;
        logger.debug('EwayBillGeneration : success, ' + successMsg);
        const suceessObj = {
          info : 'E-Invoice generated successfully.',
          description : successMsg,
          disablePayload : true
        };
        sendMail(suceessObj);
        const updateObj = {
          status : 'einvoicegenerated',
          einvoice : loadUpdationObj.einvoicejson
        };
        updateObj.ewayBillNo = loadUpdationObj.ewaybillno;
        return updateFactoryOutletOrder(updateObj, factoryOutletData.id)
        .then(() => {
          return updateLoad(loadUpdationObj)
          .then(() => {
            return updatedEwayBillToPOS(ewaybillObj)
            .then(()=> {
              console.log('success ========');
              return dumpEinvoiceDate(promiseResp, factoryOutletData, loadData)
              .then(() => {
                return resolve();
              })
              .catch((einvoiceErr) => {
                return reject(einvoiceErr);
              });
            })
            .catch((ewayBillErr)=> {
              console.log('checking error here', ewayBillErr);
              return reject(ewayBillErr);
            });
          })
          .catch((updateLoadErr) => {
            return reject(updateLoadErr);
          });
        })
        .catch((updateEwayBillStatusErr) => {
          return reject(updateEwayBillStatusErr);
        });
      }).catch((promiseErr) => {
        logger.error('Error while promising Einvoice and EwayBill Function', promiseErr);
        return reject(promiseErr);
      });
    }).catch((createPayloadErr) => {
      return reject(createPayloadErr);
    });
  });
};

const createConsignment = function(createConsignmentObj) {
  return new Promise((resolve, reject) => {
    return getPOSToken().then((token) => {
      return request({
        uri : POSConsignmentCreationApi,
        method :'PUT',
        headers : {
          authorization : token
        },
        json : true,
        body : createConsignmentObj
      }, function(consignmentCreationError, consignmentCreationResponse) {
        if (consignmentCreationResponse.statusCode === 200) {
          return resolve(consignmentCreationResponse.body);
        } else {
          const err = consignmentCreationResponse && consignmentCreationResponse.body ? consignmentCreationResponse.body : consignmentCreationError;
          return reject(err);
        }
      });
    });
  });
};

/**
 * This api used by warehouse after successful load creation
 * this api will create
 * 1. Consignment from POS Service
 * 2. Eway Bill
 * 3. Call Load updation api after successfull creation of Eway Bill
 * @param  {array}
 * @param {Object}
 * @param {String} [loadid] - loadid
 * @param {String} [poid] - poid
 * @param {String} [loadCreationDate] - loadCreationDate
 * @return {Array}
 * @return {Object} - [{loadid- 'ex', status: 'success'}, {loadid- 'ex', status: 'failed', ,message : ''}]
 */
exports.processEwayBill = (req, res, next) => {
  // accept params with multiple poids it may contain multiple loadids as well
  const schema = Joi.array().items(Joi.object().keys({
    loadId: Joi.string().required(),
    poid: Joi.string().required(),
    loadCreationDate: Joi.string().required()
  })).required();
  return schema.validate(req.params, function(err, params) {
    if (err) {
      return next(new restify.fcErrors.ValidationError(err));
    }
    const mailerObj = {
      info : 'Error while processing Factory Outlet Order for Eway Bill after secondary order and Load creation.',
      description : ''
    };
    // successArray to send the api response according to Each LoadID
    const successResArray = [];
    if (params && params.length) {
      const loadWiseData = _.groupBy(params, 'loadId');
      const loadWiseArray = [];
      for (const load in loadWiseData) {
        const obj = {};
        obj[load] = loadWiseData[load];
        loadWiseArray.push(obj);
      }
      // now process each loadId for Consignment and EwayBill generation one by one
      // ex: loadWiseArray = [{Loadid1 : [data]}, {Loadid2 : [data]}]
      return db.sequelize.Promise.mapSeries(loadWiseArray, (load) => {
        for (const loadid in load) {
          const LoadWisePOIDs = _.map(load[loadid], 'poid');
          return new Promise((resolve, reject) => {
            return db.factoryoutlet.findOne({
              where : {
                poid:{
                  $contains: LoadWisePOIDs
                }
              },
              raw : true
            }).then((factoryOutletResp) => {
              if (factoryOutletResp) {
                const updateObj = {
                  loadId : loadid,
                  loadCreationDate : load[loadid][0].loadCreationDate,
                  status : 'loadcreated'
                };
                return updateFactoryOutletOrder(updateObj, factoryOutletResp.id).then(() => {
                  const createConsignmentObj = {
                    factoryOutletID : factoryOutletResp.factoryoutletId,
                    loadid : loadid
                  };
                  updateObj.transporterGSTNo = '';
                  return createConsignment(createConsignmentObj).then((consignmentResp) => {
                    // consignment service from POS will give shipping Company as for now MLL
                    // set status to consignmentcreated
                    return updateFactoryOutletOrder({
                      status : 'consignmentcreated',
                      shippingCompany : consignmentResp.logistics
                    }, factoryOutletResp.id).then(() => {
                      updateObj.shippingCompany = consignmentResp.logistics;
                      if (updateObj.shippingCompany === 'MLL') {
                        updateObj.transporterGSTNo = MLLGSTNo;
                      }
                      if (updateObj.shippingCompany === 'Rivigo') {
                        updateObj.transporterGSTNo = RivigoGSTNo;
                      }
                      if (updateObj.shippingCompany === 'Delhivery') {
                        updateObj.transporterGSTNo = DelhiveryGSTNo;
                      }
                      if (updateObj.shippingCompany === 'Xpressbees') {
                        updateObj.transporterGSTNo = '27AAGCB3904P2ZC';
                      }

                      updateObj.awbNo = factoryOutletResp.awbNo;
                      return EwayBillGeneration(factoryOutletResp, updateObj).then(() => {
                        return updateFactoryOutletOrder({status : 'completed', accountstatus : 'Approved'}, factoryOutletResp.id).then(() => {
                          successResArray.push({loadId : loadid, status : 'success'});
                          const mailerObject = {
                            info : 'Factory Outlet Secodary order process completed.',
                            description : 'Factory Outlet Secondary order process completed including the process of Load, Consignment creation, ' +
                            'Eway Bill generation(conditional) and Load updation, for the POID(s)- '
                            + LoadWisePOIDs.join(', ') + ' for the franchisee : ' + factoryOutletResp.secondaryUserId,
                            payload : JSON.stringify(factoryOutletResp)
                          };
                          sendMail(mailerObject);
                          return resolve();
                        })
                          .catch((completedUpdateError) => {
                            return reject(completedUpdateError);
                          });
                      })
                        .catch((EwayBillGenerationErr) => {
                          logger.error('processEwayBill : EwayBillGenerationErr-  ', EwayBillGenerationErr);
                          return reject(EwayBillGenerationErr);
                        });
                    })
                      .catch((consignmentcreatedUpdateErr) => {
                        return reject(consignmentcreatedUpdateErr);
                      });
                  })
                    .catch((createConsignmentErr) => {
                      const errMsg = 'Error while creating Consignment for the Factory Outlet order having request Id- '
                      + factoryOutletResp.factoryoutletId + ' having Load Id : ' + loadid + ' , with the payload : ' + JSON.stringify(load[loadid]);
                      logger.error('processEwayBill : createConsignmentErr+  ' +  errMsg, createConsignmentErr);
                      if (mailerObj.description === '') {
                        mailerObj.description = errMsg;
                        mailerObj.error = JSON.stringify(createConsignmentErr);
                        mailerObj.apiUrl = POSConsignmentCreationApi;
                        mailerObj.payload = JSON.stringify(load[loadid]);
                        sendMail(mailerObj);
                      }
                      return reject(createConsignmentErr);
                    });
                })
                  .catch((updateStatusLoadcreatedErr) => {
                    return reject(updateStatusLoadcreatedErr);
                  });
              } else {
                successResArray.push({
                  loadId : loadid,
                  status : 'failed',
                  message : 'POID(s) not found for the Load Id : ' + loadid
                });
                return resolve('POID(s) not found for the Load Id : ' + loadid);
              }
            })
              .catch((factoryOutletFindErr) => {
                const errMsg = 'Error while finding factory outlet order in factoryoutlet table having the POID(s) : '
                + LoadWisePOIDs.join(', ') + ' for the payload : ' + JSON.stringify(load[loadid]);
                logger.error('processEwayBill : factoryOutletFindErr  ' +  errMsg, factoryOutletFindErr);
                if (mailerObj.description === '') {
                  mailerObj.description = errMsg;
                  mailerObj.error = JSON.stringify(factoryOutletFindErr);
                  mailerObj.payload = JSON.stringify(load[loadid]);
                  sendMail(mailerObj);
                }
                return next(new restify.InternalError(factoryOutletFindErr));
              });
          });
        }
      }).then(() => {
        res.send(200, {response : successResArray});
        return next();
      })
        .catch((mapSeriesErr) => {
          const errMsg = 'Error while processing each Load Id' + ' for the payload : ' + JSON.stringify(loadWiseData);
          logger.error('processEwayBill : factoryOutletFindErr  ' +  errMsg, mapSeriesErr);
          if (mailerObj.description === '') {
            mailerObj.description = errMsg;
            mailerObj.error = JSON.stringify(mapSeriesErr);
            mailerObj.payload = JSON.stringify(loadWiseData);
            sendMail(mailerObj);
          }
          return next(new restify.InternalError(mapSeriesErr));
        });
    } else {
      return next(new restify.InternalError('Please provide valida data.'));
    }
  });
};

exports.createEwayBill = (req, res, next) => {
  const schema = Joi.object().keys({
    factoryOutletData: Joi.object().keys({
      id : Joi.number().required(),
      factoryoutletId : Joi.string().required(),
      poid : Joi.array().required(),
      totalAmount : Joi.number().positive(),
      primaryUserId : Joi.number().positive(),
      secondaryUserId : Joi.number().positive()
    }),
    loadData: Joi.object().keys({
      loadId : Joi.string().required(),
      awbNo : Joi.string().required(),
      shippingCompany : Joi.string().required(),
      transporterGSTNo : Joi.string().required(),
      loadCreationDate : Joi.string().required()
    }),
  }).required();
  schema.validate(req.body, {
    stripUnknown: true
  }, (err, body) => {
    if (err) {
      return next(new restify.fcErrors.ValidationError(err));
    } else {
      return EwayBillGeneration(body.factoryOutletData, body.loadData).then(() => {
        return updateFactoryOutletOrder({status : 'completed', accountstatus : 'Approved'}, body.factoryOutletData.id).then(() => {
          const mailerObject = {
            info : 'Factory Outlet Secodary order process completed.',
            description : 'Factory Outlet Secondary order process completed including the process of Load, Consignment creation, ' +
            'Eway Bill generation(conditional) and Load updation, for the POID(s)- '
            + body.factoryOutletData.poid.join(', ') + ' for the franchisee : ' + body.factoryOutletData.secondaryUserId,
            payload : JSON.stringify(body)
          };
          sendMail(mailerObject);
          return res.send('Eway Bill generation and Load updation process completed successfully.');
        })
          .catch((completedUpdateError) => {
            logger.error('Error while updating status to Completed  for the request in the table factoryoutlets. ', completedUpdateError);
            return next(new restify.InternalError(completedUpdateError));
          });
      })
        .catch((error) => {
          logger.error('Error while processing Eway bill and load updation manually. ', error);
          return next(new restify.InternalError(error));
        });
    }
  });
};

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
