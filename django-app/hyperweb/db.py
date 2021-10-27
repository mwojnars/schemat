"""
DATA STORE -- an abstract DB storage layer for items. Handles sharding, replication etc.
"""

import csv, json, yaml
from itertools import groupby
# from pymysql.cursors import DictCursor
# from django.db import connection as db
# from nifty.db import MySQL

from main.settings import DATABASES

from .errors import ItemDoesNotExist


#####################################################################################################################################################
#####
#####  GLOBAL
#####

default_db = None

# _settings = DATABASES['default']
#
# # local database for startup
# default_db = MySQL(host         = _settings.get('HOST'),
#                    port         = _settings.get('PORT'),
#                    user         = _settings.get('USER'),
#                    password     = _settings.get('PASSWORD'),
#                    db           = _settings.get('NAME'),
#                    )

#####################################################################################################################################################
#####
#####  DATABASE
#####

class Database:
    """"""
    def insert(self, item, flush = True):
        raise NotImplementedError
    
    def insert_many(self, items, flush = True):
        for item in items:
            self.insert(item, flush = False)
        if flush: self.flush()
    
    def update(self, item, flush = True):
        raise NotImplementedError
    
    def update_many(self, items, flush = True):
        for item in items:
            self.update(item, flush = False)
        if flush: self.flush()

    def upsert(self, item, flush = True):
        """UPSERT = UPDATE or INSERT, depending whether `item` has an IID already, or not."""
        return self.insert(item, flush) if item.iid is None else self.update(item, flush)

    def upsert_many(self, items, flush = True):
        """
        Like upsert() but for multiple items at once. Splits the list into INSERT-only and UPDATE-only
        subgroups and applies insert_many() or update_many() to each of them.
        This can be overriden in subclasses to provide a more efficient implementation.
        The order of items is preserved, because it may be relevant for global data consistency in DB (?).
        """
        for no_iid, group in groupby(items, lambda item: item.iid is None):
            if no_iid: self.insert_many(group, False)
            else:      self.update_many(group, False)
        if flush: self.flush()
        

    def flush(self):
        raise NotImplementedError


class SimpleDB(Database):
    """Data store that uses only local DB, no sharding."""

    _item_columns       = 'cid iid data created updated'.split()
    _item_select_cols   = ','.join(_item_columns)
    _item_select        = f"SELECT {_item_select_cols} FROM hyper_items "
    _item_select_by_id  = _item_select + "WHERE cid = %s AND iid = %s"
    
    db = default_db

    def _make_record(self, row, query_args = None):
        
        if row is None:
            raise ItemDoesNotExist(*((query_args,) if query_args is not None else ()))
        
        return dict(zip(self._item_columns, row))
        # return {f'__{key}__': val for key, val in zip(self._item_columns, row)}

    def select(self, id_):
        """Load from DB an item with a given ID = (CID,IID) and return as a record (dict)."""
        
        # select row from DB and convert to record (dict with field names)
        with self.db.cursor() as cur:
            cur.execute(self._item_select_by_id, id_)
            row = cur.fetchone()
            return self._make_record(row, id_)

    def scan_category(self, cid):
        """
        Load from DB all items of a given category (CID) ordered by IID, possibly with a limit.
        Items are returned as an iterable of records (dicts).
        """
        query = self._item_select + f"WHERE cid = {cid} ORDER BY iid"
        # if limit is not None:
        #     query += f" LIMIT {limit}"
            
        with self.db.cursor() as cur:
            cur.execute(query)
            return map(self._make_record, cur.fetchall())
        
    def insert(self, item, flush = True):
        """
        Insert `item` as a new row in DB. Assign a new IID and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        if item.cid is None:
            item.cid = item.category.iid
        cid = item.cid
        
        max_iid = self.db.select_one(f"SELECT MAX(iid) FROM hyper_items WHERE cid = {cid} FOR UPDATE")[0]
        if max_iid is None:
            max_iid = 0
        
        iid = max_iid + 1
        item.iid = iid
        
        assert item.has_data()
        # print("store:", list(item.data.lists()))
        
        record = {'cid':   cid,
                  'iid':   iid,
                  'data':  item.dump_data(),
                  }
        self.db.insert_dict('hyper_items', record)
        
        # # get imputed fields from DB
        # (item.created, item.updated) = self.db.select_one(f"SELECT created, updated FROM hyper_items WHERE cid = {cid} AND iid = {iid}")
        
        if flush: self.db.commit()
        # return iid
        
        # # here, it is possible to split SELECT out from INSERT, but then SELECT ... FOR UPDATE must be used,
        # # so as to create a stronger lock on the DB rows involved and enable correct concurrent INSERTs
        # query = f"""
        #     INSERT INTO hyper_items(cid, iid, data)
        #     SELECT {cid}, IFNULL(MAX(iid), 0) + 1, {data}
        #       FROM hyper_items WHERE cid = {cid}
        # """

    def update(self, item, flush = True):
        """Update the contents of the item's row in DB."""
        raise NotImplementedError()

    def flush(self):
        self.db.commit()
        

#####################################################################################################################################################

class FileDB(SimpleDB):
    """Items stored in a file. For use during development only."""

    filename = None
    items    = None         # dict of {item_id: json_data}, keys are tuples (cid,iid), values are strings
    
    def select(self, id_):
        
        data = self.items[id_]
        row = id_ + (data, None, None)
        return self._make_record(row, id_)

    def scan_category(self, cid):
        
        for row in self.items.items():
            (cid_, iid_), data = row
            if cid != cid_: continue
            yield self._make_record((cid_, iid_, data, None, None))
        
    
# class CsvDB(FileDB):
#
#     def __init__(self, filename = None):
#         self.filename = filename or DATABASES['csv']['FILE']
#
#         with open(self.filename, newline = '') as f:
#             reader = csv.reader(f, delimiter = ';', quotechar = '"')
#             self.items = {(int(cid), int(iid)): data for cid, iid, data in list(reader)}
#
#             print('CsvDB items loaded:')
#             for id, data in self.items.items():
#                 print(id, data)
#
# class JsonDB(FileDB):
#     """Items stored in a JSON file. For use during development only."""
#
#     def __init__(self, filename = None):
#         self.filename = filename or DATABASES['json']['FILE']
#         self.reload()
#
#     def reload(self):
#         self.items = {}
#         for data in json.load(open(self.filename)):
#             id_ = data.pop('id')
#             self.items[tuple(id_)] = json.dumps(data)
#
#         print('JsonDB items loaded:')
#         for id, data in self.items.items():
#             print(id, data)
    
class YamlDB(FileDB):
    """Items stored in a YAML file. For use during development only."""

    max_iid = None      # dict of current maximum IIDs per category, as {cid: maximum_iid}

    def __init__(self, filename = None):
        self.filename = filename or DATABASES['yaml']['FILE']
        self.items = {}
        self.max_iid = {}
        # self.load()
    
    def load(self):
        db = yaml.safe_load(open(self.filename))
        self.items = {}
        self.max_iid = {}
        
        for flat in db or []:
            id = flat.pop('id')
            if not id: continue             # if ID is null or empty [], treat this item as a draft that should be omitted
            cid, iid = id
            id = (cid, iid)
            assert id not in self.items, f"duplicate item ID: {id}"
            curr_max = self.max_iid.get(cid, 0)
            self.max_iid[cid] = max(curr_max, iid)
            self.items[id] = json.dumps(flat)
        
        print('YamlDB items loaded:')
        for id, data in self.items.items():
            print(id, data)
    
    def insert(self, item, flush = True):
        
        if item.cid is None:
            item.cid = item.category.iid
        cid = item.cid
        
        if cid == 0 and cid not in self.max_iid:
            max_iid = -1   # use =0 if the root category is not getting an IID here
        else:
            max_iid = self.max_iid.get(cid, 0)
            
        item.iid = iid = max_iid + 1
        self.max_iid[cid] = iid
        
        assert item.has_data()
        assert item.id not in self.items
        # print("store:", list(item.data.lists()))
        
        self.items[item.id] = item.dump_data()

        if flush: self.flush()
    
    def update(self, item, flush = True):
        
        assert item.has_data()
        assert item.has_id()
        self.items[item.id] = item.dump_data()
        if flush: self.flush()
    
    def flush(self):
        """Save the entire database (self.items) to a file."""
        flats = []

        for id, raw in self.items.items():
            
            flat = {'id': list(id)}
            flat.update(json.loads(raw))
            flats.append(flat)
            
        print(f"YamlDB flushing {len(self.items)} items to {self.filename}...")
        out = open(self.filename, 'wt')
        yaml.dump(flats, stream = out, default_flow_style = None, sort_keys = False, allow_unicode = True)
        
    