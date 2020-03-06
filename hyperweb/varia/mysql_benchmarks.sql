================================================================
MYSQL PERFORMANCE TESTS

-------
DROP TABLE IF EXISTS _test_json_compressed;
DROP TABLE IF EXISTS _test_json_compact;
DROP TABLE IF EXISTS _test_text_compressed;
DROP TABLE IF EXISTS _test_text_compact;

CREATE TABLE _test_json_compressed
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data JSON NOT NULL,
    created TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2),
    updated TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2)
    
) ENGINE=InnoDB ROW_FORMAT=COMPRESSED;


CREATE TABLE _test_json_compact
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data JSON NOT NULL,
    created TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2),
    updated TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2)
    
) ENGINE=InnoDB ROW_FORMAT=COMPACT;


CREATE TABLE _test_text_compressed
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data TEXT NOT NULL,
    created TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2),
    updated TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2)
    
) ENGINE=InnoDB ROW_FORMAT=COMPRESSED;


CREATE TABLE _test_text_compact
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    data TEXT NOT NULL,
    created TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2),
    updated TIMESTAMP(2) NOT NULL DEFAULT CURRENT_TIMESTAMP(2) ON UPDATE CURRENT_TIMESTAMP(2)
    
) ENGINE=InnoDB ROW_FORMAT=COMPACT;

-------
DROP PROCEDURE IF EXISTS _test_insert;
DELIMITER |
CREATE PROCEDURE _test_insert()
BEGIN
    DECLARE i int DEFAULT 0;
    DECLARE value TEXT DEFAULT '{"title":"Ala ma kota Sierściucha i psa Kłapoucha.","fulltext":"some text some text some text some text some text some text MHLSRFLLLXRPULYJNJMWKJZKLVJUQOOLIWLNQHLRZYIQKOVIQOF PFLLTYJRVUORUXIXQGRPIFUOHSOWRWPGRLSWJYTMUSFOMFMFWJWIUHJXVXQHZROJZJKHXLFFLPLFWXTXSWFHOIQNJWRUOOMYNVTIKHUTFQWYIKZUZHQFHRZTQTZVJULGIVHKGXXRILRFZGZLJLSMJNIMHRNPGPLLOZWJJUGVOLOLKGKOYRWIWURZPOIMVUFUVTMJZHJRVZGFRRFQGJFTTIUHUKIOMOKZPYWFHLFPKLRWQWUQLXZUGNLIVITVXFPOPSSSMKHIQLISHSKOKPMRMOYTKFJNUUHIOHTZYSZHZLQXHKNZRZMXQVGWFWXUHYGSFOXXVGSRWSGHRPNFFNFZOGVFFOLKPMVGKPRTOISOHKSPZZSVHXUOZSSTFGI QPKVKUYQQFJLIVKPHJXQHMSJNWSIUYTIPZOWXXSONIZYHZZIMOIJHRRZVJHMHOSONLQWNNQFINOONJFQXSMNVJGQFIFOMTNNIMWRUVPUWGOYOWOHLFQURGJNZRXMRJKTUZFPOLXGXGKVKIVFTQIIORMNUOPMNYPYNLLRVJUMJJPRRFOOMNXP MTNMWXSWWSXGJFQHMITUFIXTGIKRKTRQPRWQRJFZRKJSZFYYSXWJPVLTGUFOOSLJFRJJHKVVSUKVQNSSQURGGXMGMHLSRWUNOLUJUWXQJSMUOKKPFWQURQKFIKLVIMHSNFVJZOKRNSUQRIYLVSIPOTVUGZKNVWOWHWTYMWVXJFGMVYIMRIYSKUSJQGJHPZJKUFJYPUNVXJHTWKVZFVFHIWPGZPOHZOGYLKZFKTHIZSKJTJZM","value":100000,"another_value":23.046,"struct":[123,4567854,98765400,null]}';
    
    WHILE i < 1000 DO
        INSERT INTO _test_text_compact(data) VALUES
            (value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),
            (value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),
            (value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),
            (value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),
            (value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value),(value)
        ;
        SET i = i + 1;
    END WHILE;
    COMMIT;
END |
DELIMITER ;

CALL _test_insert();

        INSERT INTO _test_json_compressed(data) VALUES 
        INSERT INTO _test_json_compact(data) VALUES
        INSERT INTO _test_text_compressed(data) VALUES
        INSERT INTO _test_text_compact(data) VALUES

-- table sizes according to mysql:
  select * from INFORMATION_SCHEMA.INNODB_TABLESPACES where name LIKE 'catalog/_test_%';
-- table sizes on disk:
  $ ls -ha /var/lib/mysql/catalog

-------
RESULTS:
-- insert same record 100K times to a new table (1000 inserts per 100 records each), length of JSON string 252 bytes + static fields (id,created,updated)
-- high in-page between-record compressibility bcs of equal content in all records
  _test_json_compressed:   74.52 s   19922944 bytes on disk (19M)   >> 199 bytes per record
  _test_json_compact:      72.65 s   41943040 bytes on disk (40M)
  _test_text_compressed:   73.43 s   18874368 bytes on disk (18M)
  _test_text_compact:      73.05 s   41943040 bytes on disk (40M)
  
-- insert same record 100K times to a new table (1000 inserts per 100 records each), length of JSON string 1054 bytes + static fields (id,created,updated)
-- high in-page between-record compressibility bcs of equal content in all records
  _test_json_compressed:   89.14 s   67108864 bytes on disk (64M)   >> 671 bytes per record = 65% of raw record size
  _test_json_compact:      88.14 s  138412032 bytes on disk (112M)
  _test_text_compressed:   87.55 s   67108864 bytes on disk (64M)
  _test_text_compact:      82.68 s  138412032 bytes on disk (112M)

Conclusions:
-- "compressed" gives up to 50% reduction in disk usage (this is much; the reduction can possibly be smaller with less reduntant records)
-- "json" requires between 0-5% more disk space (insignificant)
-- "json+compressed" combined require 1-5% longer insert times (insignificant)
