-- Adminer 4.7.6 MySQL dump

SET NAMES utf8;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

DROP TABLE IF EXISTS `hyper_items`;
CREATE TABLE `hyper_items` (
  `cid` smallint unsigned NOT NULL COMMENT 'IID of the category this item belongs to; must be in <0,65535> range',
  `iid` bigint unsigned NOT NULL COMMENT 'IID (Item ID) of this item; unique within its category only',
  `data` json NOT NULL,
  `created` timestamp(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2),
  `updated` timestamp(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2),
  PRIMARY KEY (`cid`,`iid`)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin ROW_FORMAT=COMPRESSED;

INSERT INTO `hyper_items` (`cid`, `iid`, `data`, `created`, `updated`) VALUES
(0,	0,	'{\"doc\": \"Category of items that represent categories.\", \"name\": \"Category\", \"schema\": {\"@\": \"$Schema\", \"fields\": {\"schema\": {\"@\": \"$Object\", \"class_\": {\"=\": \"$Schema\", \"@\": \"!type\"}, \"strict\": true}, \"itemclass\": {\"@\": \"$Class\"}}}}',	'2020-03-08 22:15:43.00',	'2020-03-12 13:40:45.20'),
(0,	1,	'{\"doc\": \"Category of site records. A site contains information about applications, servers, start up.\", \"name\": \"Site\", \"schema\": {\"fields\": {\"app\": {\"@\": \"$Link\", \"cid\": 2}}}, \"itemclass\": \"$Site\"}',	'2020-03-09 11:37:48.00',	'2020-03-12 13:02:02.22'),
(0,	2,	'{\"doc\": \"Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.\", \"name\": \"Application\", \"schema\": {\"fields\": {\"spaces\": {\"@\": \"$Dict\", \"keys\": {\"@\": \"$String\"}, \"values\": {\"@\": \"$Link\", \"cid\": 3}}}}, \"itemclass\": \"$Application\"}',	'2020-03-11 19:55:46.00',	'2020-03-12 13:02:07.44'),
(0,	3,	'{\"doc\": \"Category of items that represent item spaces.\", \"name\": \"Space\", \"schema\": {\"fields\": {\"categories\": {\"@\": \"$Dict\", \"keys\": {\"@\": \"$String\"}, \"values\": {\"@\": \"$Link\", \"cid\": 0}}}}, \"itemclass\": \"$Space\"}',	'2020-03-09 12:13:45.00',	'2020-03-12 13:02:31.87'),
(0,	4,	'{\"doc\": \"Category of items that represent mappings, i.e., sharded indexes on top of item-item or item-value relations.\", \"name\": \"Mapping\"}',	'2020-03-11 19:52:50.00',	'2020-04-19 12:22:56.82'),
(0,	100,	'{\"doc\": \"Category of items that do not belong to any specific category.\", \"name\": \"Item\", \"schema\": {\"fields\": {}}, \"itemclass\": \"$Item\"}',	'2020-03-09 11:10:46.00',	'2020-03-12 13:41:18.65'),
(1,	1,	'{\"app\": 1, \"name\": \"catalog.wiki\", \"base_url\": \"http://localhost:8001\"}',	'2020-03-12 13:05:45.00',	'2020-03-12 13:22:15.07'),
(2,	1,	'{\"name\": \"Catalog.wiki\", \"spaces\": {\"sys\": 2, \"meta\": 1}}',	'2020-03-12 13:07:26.00',	'2020-03-12 13:22:22.62'),
(3,	1,	'{\"name\": \"Meta\", \"categories\": {\"map\": 4, \"item\": 100, \"category\": 0}}',	'2020-03-12 13:23:27.00',	'2020-04-19 12:44:58.45'),
(3,	2,	'{\"name\": \"System\", \"categories\": {\"app\": 2, \"site\": 1, \"space\": 3}}',	'2020-03-12 13:24:09.00',	'2020-03-12 13:40:30.81'),
(100,	1,	'{\"multi\": [1, 2, null], \"title\": \"Ala ma kota Sierściucha i psa Kłapoucha.\", \"value\": 100000, \"struct\": [[123, 4567854, 98765400, null]], \"fulltext\": \"some text some text some text some text some text some text some text some text\", \"another_value\": 23.046}',	'2020-03-06 12:47:48.00',	'2020-03-12 13:41:50.26'),
(100,	2,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ąłęÓŁŻŹŚ\"}',	'2020-04-14 21:45:05.30',	'2020-04-14 21:45:05.30'),
(100,	3,	'{\"name\": [\"test_item2\"], \"title\": \"ąłęÓŁŻŹŚ\"}',	'2020-04-22 17:29:35.13',	'2020-04-22 17:29:35.13'),
(100,	4,	'{\"name\": \"test_item3\", \"title\": \"ąłęÓŁŻŹŚ\"}',	'2020-04-22 17:34:16.49',	'2020-04-22 17:34:16.49'),
(100,	5,	'{\"name\": \"test_item4\", \"title\": \"ąłęÓŁŻŹŚ\"}',	'2020-04-22 17:34:33.23',	'2020-04-22 17:34:33.23'),
(100,	6,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ąłęÓŁŻŹŚ\"}',	'2021-02-10 00:09:31.28',	'2021-02-10 00:09:31.28'),
(100,	7,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ABCD\"}',	'2021-02-16 23:15:57.26',	'2021-02-16 23:15:57.26'),
(100,	8,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ABCD\"}',	'2021-02-17 19:27:49.41',	'2021-02-17 19:27:49.41'),
(100,	9,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ABCD\"}',	'2021-02-17 19:28:51.42',	'2021-02-17 19:28:51.42'),
(100,	10,	'{\"name\": [\"test_item\", \"duplicate\"], \"title\": \"ABCD\"}',	'2021-02-17 21:13:43.45',	'2021-02-17 21:13:43.45');

-- 2021-05-11 11:22:04
